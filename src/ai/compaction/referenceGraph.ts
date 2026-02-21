// ============================================================================
// Smart Context Compaction - Reference Graph
// ============================================================================
//
// Tracks dependency relationships between messages so that when we decide to
// keep a message we also keep everything it depends on.

import type { ChatMessage } from "@/ai/types";
import { extractDbEntities } from "./scorer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferenceGraph {
  /** Map from message id → set of message ids this message depends on */
  edges: Map<string, Set<string>>;

  /** Map from DB entity name → message ids that first defined / surfaced it */
  entitySources: Map<string, Set<string>>;
}

// ---------------------------------------------------------------------------
// Build graph
// ---------------------------------------------------------------------------

/**
 * Builds a lightweight dependency graph over the conversation.
 *
 * Edges are added when:
 * 1. A message uses a DB entity that was first introduced by an earlier message.
 * 2. An assistant message follows a tool-result message and likely references it.
 * 3. A user message is an immediate follow-up to an assistant message (reply pair).
 */
export function buildReferenceGraph(messages: ChatMessage[]): ReferenceGraph {
  const edges = new Map<string, Set<string>>();
  const entitySources = new Map<string, Set<string>>();

  const addEdge = (from: string, to: string) => {
    if (from === to) return;
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  };

  const addEntitySource = (entity: string, msgId: string) => {
    if (!entitySources.has(entity)) entitySources.set(entity, new Set());
    entitySources.get(entity)!.add(msgId);
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Ensure every message has an entry
    if (!edges.has(msg.id)) edges.set(msg.id, new Set());

    // Rule 1 — entity provenance: link to earlier messages that surfaced this entity
    const entities = extractDbEntities(msg.content);
    for (const entity of entities) {
      const sources = entitySources.get(entity);
      if (sources) {
        for (const srcId of sources) {
          addEdge(msg.id, srcId);
        }
      } else {
        // This is the first mention — record this message as the source
        addEntitySource(entity, msg.id);
      }
    }

    // Also register entities surfaced by tool results
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.result) {
          const resultEntities = extractDbEntities(tc.result);
          for (const entity of resultEntities) {
            addEntitySource(entity, msg.id);
          }
        }
        // Tool input entity sources
        const inputStr = JSON.stringify(tc.input);
        const inputEntities = extractDbEntities(inputStr);
        for (const entity of inputEntities) {
          addEntitySource(entity, msg.id);
        }
      }
    }

    // Rule 2 — tool result coupling: an assistant message that immediately follows
    // tool calls is tightly coupled to those results
    if (i > 0) {
      const prev = messages[i - 1];
      if (prev.toolCalls && prev.toolCalls.length > 0 && msg.role === "assistant") {
        addEdge(msg.id, prev.id);
      }
    }

    // Rule 3 — conversational reply pairs: each user message depends on the
    // immediately preceding assistant message (to preserve conversational flow)
    if (msg.role === "user" && i > 0) {
      const prev = messages[i - 1];
      if (prev.role === "assistant") {
        addEdge(msg.id, prev.id);
      }
    }
  }

  return { edges, entitySources };
}

// ---------------------------------------------------------------------------
// Transitive closure
// ---------------------------------------------------------------------------

/**
 * Given a seed set of message ids, return the full transitive closure —
 * i.e., all message ids that must also be kept because the seed depends on them.
 */
export function transitiveClosure(
  seedIds: Set<string>,
  graph: ReferenceGraph
): Set<string> {
  const result = new Set<string>(seedIds);
  const queue = Array.from(seedIds);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = graph.edges.get(current);
    if (!deps) continue;

    for (const dep of deps) {
      if (!result.has(dep)) {
        result.add(dep);
        queue.push(dep);
      }
    }
  }

  return result;
}
