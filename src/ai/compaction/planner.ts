// ============================================================================
// Smart Context Compaction - Compaction Planner
// ============================================================================
//
// Decides which messages to keep verbatim, which groups to summarize, and
// which to discard entirely — respecting token budgets and reference deps.

import type { ChatMessage } from "@/ai/types";
import { scoreConversation, estimateTokens } from "./scorer";
import type { ScoredMessage, MessageImportance } from "./scorer";
import { buildReferenceGraph, transitiveClosure } from "./referenceGraph";
import { clusterMessages } from "./clustering";
import type { MessageCluster } from "./clustering";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionPlan {
  /** Messages to include verbatim in the compacted history */
  keep: ChatMessage[];
  /** Clusters of messages to replace with an AI-generated summary */
  summarize: MessageCluster[];
  /** Messages that will be dropped entirely */
  discard: ChatMessage[];
  /** Stats for logging / UI */
  stats: {
    originalMessages: number;
    keptMessages: number;
    summarizedClusters: number;
    discardedMessages: number;
    estimatedOriginalTokens: number;
    estimatedSavedTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Planner config
// ---------------------------------------------------------------------------

interface PlannerConfig {
  /**
   * Target fraction of the current token count to reduce to.
   * 0.4 means "try to reach 40% of original tokens".
   */
  targetFraction: number;
  /**
   * Number of most-recent messages that are ALWAYS kept verbatim regardless of
   * importance (the model needs fresh context to continue coherently).
   */
  recentWindowSize: number;
  /**
   * Minimum number of messages before we bother running compaction.
   */
  minMessages: number;
}

const DEFAULT_CONFIG: PlannerConfig = {
  targetFraction: 0.4,
  recentWindowSize: 6,
  minMessages: 8,
};

// ---------------------------------------------------------------------------
// Importance ordering for greedy phase
// ---------------------------------------------------------------------------

const IMPORTANCE_ORDER: Record<MessageImportance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Produces a CompactionPlan for the given message list.
 *
 * Algorithm:
 * 1. Score every message.
 * 2. Always keep the N most recent messages (recentWindowSize).
 * 3. Always keep critical messages + their transitive deps.
 * 4. Greedily add high-importance messages up to the token budget.
 * 5. Cluster remaining non-discarded messages → to summarize.
 * 6. Discard low-importance messages not reachable from any kept message.
 */
export function planCompaction(
  messages: ChatMessage[],
  config: Partial<PlannerConfig> = {}
): CompactionPlan {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (messages.length < cfg.minMessages) {
    // Nothing to compact — keep everything
    return {
      keep: [...messages],
      summarize: [],
      discard: [],
      stats: {
        originalMessages: messages.length,
        keptMessages: messages.length,
        summarizedClusters: 0,
        discardedMessages: 0,
        estimatedOriginalTokens: messages.reduce((s, m) => s + estimateTokens(m), 0),
        estimatedSavedTokens: 0,
      },
    };
  }

  // ── Step 1: Score ────────────────────────────────────────────────────────
  const scored = scoreConversation(messages);
  const scoreById = new Map<string, ScoredMessage>(
    scored.map((sm) => [sm.message.id, sm])
  );

  const originalTokens = scored.reduce((s, sm) => s + sm.tokens, 0);
  const tokenBudget = Math.floor(originalTokens * cfg.targetFraction);

  // ── Step 2: Pin the most-recent window ──────────────────────────────────
  const recentIds = new Set<string>(
    messages.slice(-cfg.recentWindowSize).map((m) => m.id)
  );

  // ── Step 3: Build reference graph ────────────────────────────────────────
  const graph = buildReferenceGraph(messages);

  // ── Step 4: Always-keep set (critical + recent) ──────────────────────────
  const keepIds = new Set<string>(recentIds);

  for (const sm of scored) {
    if (sm.importance === "critical") {
      keepIds.add(sm.message.id);
    }
  }

  // Expand to transitive closure (pull in dependencies)
  const closure = transitiveClosure(keepIds, graph);
  closure.forEach((id) => keepIds.add(id));

  // ── Step 5: Greedy add by importance up to token budget ──────────────────
  let spentTokens = [...keepIds]
    .reduce((s, id) => s + (scoreById.get(id)?.tokens ?? 0), 0);

  // Sort non-kept messages by importance (critical first)
  const remaining = scored
    .filter((sm) => !keepIds.has(sm.message.id))
    .sort((a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance]);

  for (const sm of remaining) {
    if (spentTokens >= tokenBudget) break;
    if (sm.importance === "low") continue; // skip low in greedy phase

    // Compute cost including transitive deps
    const depClosure = transitiveClosure(new Set([sm.message.id]), graph);
    const depCost = [...depClosure]
      .filter((id) => !keepIds.has(id))
      .reduce((s, id) => s + (scoreById.get(id)?.tokens ?? 0), 0);

    if (spentTokens + depCost <= tokenBudget) {
      depClosure.forEach((id) => keepIds.add(id));
      spentTokens += depCost;
    }
  }

  // ── Step 6: Partition remaining into summarize / discard ─────────────────
  const notKept = scored.filter((sm) => !keepIds.has(sm.message.id));

  // Messages with at least medium importance get clustered for summarization
  const toSummarize = notKept.filter(
    (sm) => sm.importance === "medium" || sm.importance === "high"
  );

  // Low-importance messages without any kept deps are discarded
  const toDiscard = notKept.filter((sm) => sm.importance === "low");

  // Cluster the summarizable messages
  const clusters = clusterMessages(toSummarize);

  // ── Step 7: Build ordered keep list (preserving original order) ──────────
  const keepList = messages.filter((m) => keepIds.has(m.id));

  const savedTokens = notKept.reduce((s, sm) => s + sm.tokens, 0);

  return {
    keep: keepList,
    summarize: clusters,
    discard: toDiscard.map((sm) => sm.message),
    stats: {
      originalMessages: messages.length,
      keptMessages: keepList.length,
      summarizedClusters: clusters.length,
      discardedMessages: toDiscard.length,
      estimatedOriginalTokens: originalTokens,
      estimatedSavedTokens: savedTokens,
    },
  };
}
