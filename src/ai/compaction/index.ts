// ============================================================================
// Smart Context Compaction - Orchestrator
// ============================================================================
//
// Public API for the compaction system. Call `compactConversation` to produce
// a shorter, semantically equivalent conversation history.

import type { ChatMessage } from "@/ai/types";
import type { LanguageModel } from "ai";
import { planCompaction } from "./planner";
import { summarizeCluster, summaryToChatMessage } from "./summarizer";
import type { CompactionPlan } from "./planner";

// Re-export for convenience
export type { CompactionPlan };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionResult {
  /** The compacted message history, ready to replace the original */
  messages: ChatMessage[];
  /** Human-readable stats */
  stats: CompactionPlan["stats"] & {
    summariesGenerated: number;
  };
}

export interface CompactionOptions {
  /**
   * Fraction of original tokens to target (0–1).
   * Default: 0.4 (reduce to ~40% of original size).
   */
  targetFraction?: number;
  /**
   * Number of most-recent messages always kept verbatim.
   * Default: 6
   */
  recentWindowSize?: number;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Compacts a conversation history using importance scoring, reference
 * tracking, topic clustering and AI summarization.
 *
 * @param messages - The current full conversation history.
 * @param model    - The AI model to use for generating cluster summaries.
 * @param options  - Optional tuning parameters.
 * @returns        - A CompactionResult with the new shorter history.
 */
export async function compactConversation(
  messages: ChatMessage[],
  model: LanguageModel,
  options: CompactionOptions = {}
): Promise<CompactionResult> {
  // ── 1. Plan ───────────────────────────────────────────────────────────────
  const plan = planCompaction(messages, {
    targetFraction: options.targetFraction ?? 0.4,
    recentWindowSize: options.recentWindowSize ?? 6,
  });

  console.log(
    `[Compaction] Plan: keep=${plan.keep.length}, ` +
    `summarize_clusters=${plan.summarize.length}, ` +
    `discard=${plan.discard.length}, ` +
    `tokens: ${plan.stats.estimatedOriginalTokens} → save ~${plan.stats.estimatedSavedTokens}`
  );

  // If there is nothing to summarize, return only the kept messages
  if (plan.summarize.length === 0) {
    return {
      messages: plan.keep,
      stats: { ...plan.stats, summariesGenerated: 0 },
    };
  }

  // ── 2. Summarize clusters in parallel ─────────────────────────────────────
  const summaryMessages: ChatMessage[] = [];

  // Run summarizations in parallel (clusters are independent)
  const summaryResults = await Promise.allSettled(
    plan.summarize.map((cluster) => summarizeCluster(cluster, model))
  );

  for (const result of summaryResults) {
    if (result.status === "fulfilled") {
      summaryMessages.push(summaryToChatMessage(result.value));
      console.log(
        `[Compaction] Summary generated for "${result.value.topic}" ` +
        `(${result.value.originalMessageIds.length} msgs → ~${result.value.estimatedTokens} tokens)`
      );
    } else {
      console.warn("[Compaction] Failed to summarize cluster:", result.reason);
    }
  }

  // ── 3. Assemble compacted history ─────────────────────────────────────────
  //
  // Ordering strategy:
  //   [summary messages]   ← compressed history at the front
  //   [kept messages]      ← important verbatim messages (in original order)
  //
  // This keeps the model's recent context intact while giving it summarized
  // background at the top.
  const compacted: ChatMessage[] = [...summaryMessages, ...plan.keep];

  return {
    messages: compacted,
    stats: {
      ...plan.stats,
      summariesGenerated: summaryMessages.length,
    },
  };
}
