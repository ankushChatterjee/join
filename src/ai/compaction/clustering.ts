// ============================================================================
// Smart Context Compaction - Topic Clustering
// ============================================================================
//
// Groups messages by shared topic (intent + DB entities) so they can be
// summarized together as coherent chunks rather than individual items.

import type { ScoredMessage, ConversationIntent } from "./scorer";
import { jaccardSimilarity } from "./utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageCluster {
  /** Primary intent that defines this cluster */
  intent: ConversationIntent;
  /** Union of DB entities mentioned across the cluster's messages */
  entities: string[];
  /** Ordered messages in this cluster */
  messages: ScoredMessage[];
  /** Human-readable topic label for use in summaries */
  topic: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function intentLabel(intent: ConversationIntent): string {
  const labels: Record<ConversationIntent, string> = {
    schema_explore: "Schema Exploration",
    query_build: "Query Building",
    debug: "Debugging Session",
    explain: "Explanation",
    phatic: "General Chat",
    unknown: "Conversation",
  };
  return labels[intent] ?? "Conversation";
}

// ---------------------------------------------------------------------------
// Cluster algorithm
// ---------------------------------------------------------------------------

/**
 * Clusters messages into coherent groups for summarization.
 *
 * Strategy:
 * 1. Sliding window: messages within MAX_WINDOW consecutive positions can form
 *    a cluster if they share intent or DB entities.
 * 2. Intent shift: when the conversation changes topic (e.g., schema_explore →
 *    query_build), start a new cluster.
 * 3. Entity overlap: messages that share DB entities are merged even if intent
 *    differs slightly (e.g., explain + query_build for the same tables).
 *
 * The result is a list of clusters in conversation order.
 */
export function clusterMessages(messages: ScoredMessage[]): MessageCluster[] {
  if (messages.length === 0) return [];

  const clusters: MessageCluster[] = [];
  let currentCluster: ScoredMessage[] = [messages[0]];
  let currentIntent: ConversationIntent = messages[0].intent;
  let currentEntities = new Set(messages[0].dbEntities);

  const finaliseCluster = () => {
    if (currentCluster.length === 0) return;

    const allEntities = new Set<string>();
    for (const sm of currentCluster) {
      sm.dbEntities.forEach((e) => allEntities.add(e));
    }

    // Choose a representative intent (most common non-unknown one)
    const intentCounts = new Map<ConversationIntent, number>();
    for (const sm of currentCluster) {
      if (sm.intent !== "unknown" && sm.intent !== "phatic") {
        intentCounts.set(sm.intent, (intentCounts.get(sm.intent) ?? 0) + 1);
      }
    }
    let representativeIntent: ConversationIntent = currentIntent;
    let maxCount = 0;
    for (const [intent, count] of intentCounts) {
      if (count > maxCount) {
        maxCount = count;
        representativeIntent = intent;
      }
    }

    const topEntities = Array.from(allEntities).slice(0, 3);
    const entitySuffix =
      topEntities.length > 0 ? ` (${topEntities.join(", ")})` : "";

    clusters.push({
      intent: representativeIntent,
      entities: Array.from(allEntities),
      messages: [...currentCluster],
      topic: intentLabel(representativeIntent) + entitySuffix,
    });
  };

  for (let i = 1; i < messages.length; i++) {
    const sm = messages[i];
    const newEntities = new Set(sm.dbEntities);

    // Compute how similar this message is to the current cluster
    const intentMatch =
      sm.intent === currentIntent ||
      sm.intent === "unknown" ||
      sm.intent === "phatic" ||
      currentIntent === "unknown";

    const entitySimilarity = jaccardSimilarity(currentEntities, newEntities);

    // Also check entity overlap (if they share at least one entity, keep together)
    const sharedEntities =
      newEntities.size > 0 &&
      currentEntities.size > 0 &&
      [...newEntities].some((e) => currentEntities.has(e));

    const shouldMerge =
      intentMatch || entitySimilarity > 0.2 || sharedEntities;

    // Hard-cut: never let a cluster grow beyond 10 messages to keep summaries focused
    const clusterTooLong = currentCluster.length >= 10;

    if (shouldMerge && !clusterTooLong) {
      currentCluster.push(sm);
      sm.dbEntities.forEach((e) => currentEntities.add(e));
      // Update intent if this message has a more specific one
      if (sm.intent !== "unknown" && sm.intent !== "phatic") {
        currentIntent = sm.intent;
      }
    } else {
      finaliseCluster();
      currentCluster = [sm];
      currentIntent = sm.intent;
      currentEntities = new Set(sm.dbEntities);
    }
  }

  finaliseCluster();
  return clusters;
}
