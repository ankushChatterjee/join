// ============================================================================
// Smart Context Compaction - Message Scorer
// ============================================================================
//
// Assigns an importance score to each message based on signals extracted from
// its content and tool calls. Higher scores = higher priority to preserve.

import type { ChatMessage } from "@/ai/types";
import { estimateTokensFromText } from "./utils";

export type MessageImportance = "critical" | "high" | "medium" | "low";

export interface ScoredMessage {
  message: ChatMessage;
  importance: MessageImportance;
  reasons: string[];
  tokens: number;
  /** DB object names (tables, schemas, columns) referenced in this message */
  dbEntities: string[];
  /** Intent classification */
  intent: ConversationIntent;
}

export type ConversationIntent =
  | "schema_explore"
  | "query_build"
  | "debug"
  | "explain"
  | "phatic"
  | "unknown";

// ---------------------------------------------------------------------------
// Token estimation (character-based heuristic — no tokenizer needed here)
// ---------------------------------------------------------------------------

export function estimateTokens(msg: ChatMessage): number {
  let text = msg.content;
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      text += JSON.stringify(tc);
    }
  }
  return estimateTokensFromText(text);
}

// ---------------------------------------------------------------------------
// DB entity extraction
// ---------------------------------------------------------------------------

// Matches schema-qualified names (public.users) or bare identifiers inside backticks
const SCHEMA_QUALIFIED_RE = /\b([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\b/g;
const BACKTICK_NAME_RE = /`([a-zA-Z_][a-zA-Z0-9_.]*)`/g;
const SQL_KEYWORD_NAMES_RE =
  /(?:FROM|JOIN|INTO|UPDATE|TABLE|VIEW)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;

export function extractDbEntities(text: string): string[] {
  const found = new Set<string>();

  for (const m of text.matchAll(SCHEMA_QUALIFIED_RE)) {
    found.add(m[1].toLowerCase());
  }
  for (const m of text.matchAll(BACKTICK_NAME_RE)) {
    found.add(m[1].toLowerCase());
  }
  for (const m of text.matchAll(SQL_KEYWORD_NAMES_RE)) {
    found.add(m[1].toLowerCase());
  }

  return Array.from(found);
}

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

export function classifyIntent(msg: ChatMessage): ConversationIntent {
  const text = (msg.content + " " + (msg.toolCalls?.map((tc) => tc.name).join(" ") ?? ""))
    .toLowerCase();

  const schemaKeywords = /describe_table|list_tables|list_schemas|list_views|list_functions|schema|columns?|indexes?|foreign.?keys?|get_database_overview/;
  const queryKeywords = /\bselect\b|\bjoin\b|\bwhere\b|\bgroup by\b|\border by\b|insert_sql|replace_editor_content|add_cell|lint_sql|execute_readonly/;
  const debugKeywords = /error|exception|fail|wrong|incorrect|not working|why|issue|problem|bug/;
  const explainKeywords = /explain|what is|what does|how does|tell me about|describe|understand/;
  const phaticKeywords = /^(hi|hello|hey|thanks|thank you|great|ok|okay|sure|yes|no|got it|perfect|sounds good|cool)[\s.!]*$/;

  if (phaticKeywords.test(msg.content.trim().toLowerCase())) return "phatic";
  if (schemaKeywords.test(text)) return "schema_explore";
  if (debugKeywords.test(text)) return "debug";
  if (explainKeywords.test(text)) return "explain";
  if (queryKeywords.test(text)) return "query_build";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

/** Returns true if the message content contains SQL that looks accepted/final */
function hasAcceptedSql(msg: ChatMessage): boolean {
  if (msg.role !== "assistant") return false;
  // Look for fenced SQL blocks in assistant response
  return /```sql[\s\S]+?```/i.test(msg.content);
}

/** Check if message contains user preferences / requirements statements */
function containsPreference(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(always|never|must|don'?t|do not|prefer|use only|avoid|make sure|remember|i want|i need|i prefer|going forward|from now on)\b/.test(
    lower
  );
}

/** Check if a message is a purely phatic exchange */
function isPhatic(text: string): boolean {
  return /^(hi|hello|hey|thanks|thank you|great|ok|okay|sure|yes|no|got it|perfect|sounds good|cool|awesome|nice)[\s.!?,]*$/i.test(
    text.trim()
  );
}

/** Returns true if the message contains only failed tool calls with no other content */
function isOnlyFailedToolCalls(msg: ChatMessage): boolean {
  if (!msg.toolCalls || msg.toolCalls.length === 0) return false;
  const allFailed = msg.toolCalls.every((tc) => tc.isError);
  const hasContent = msg.content.trim().length > 0;
  return allFailed && !hasContent;
}

/** Check if tool calls in a message are pure schema-listing operations */
function isSchemaListing(msg: ChatMessage): boolean {
  if (!msg.toolCalls) return false;
  const listingTools = new Set(["list_schemas", "list_tables", "list_views", "list_functions"]);
  return msg.toolCalls.every((tc) => listingTools.has(tc.name));
}

/** Check if the message appears to insert/modify SQL in the editor */
function isEditorMutation(msg: ChatMessage): boolean {
  if (!msg.toolCalls) return false;
  const mutationTools = new Set(["insert_sql", "replace_editor_content", "add_cell"]);
  return msg.toolCalls.some((tc) => mutationTools.has(tc.name));
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export interface ConversationContext {
  /** All messages in the conversation (for cross-reference) */
  allMessages: ChatMessage[];
}

export function scoreMessage(
  msg: ChatMessage,
  ctx: ConversationContext
): ScoredMessage {
  const signals: Array<{ weight: number; reason: string }> = [];

  // ------------------------------------------------------------------
  // CRITICAL signals (weight 8–10)
  // ------------------------------------------------------------------

  if (hasAcceptedSql(msg)) {
    signals.push({ weight: 10, reason: "contains_accepted_sql" });
  }

  if (isEditorMutation(msg)) {
    signals.push({ weight: 9, reason: "editor_mutation" });
  }

  if (containsPreference(msg.content) && msg.role === "user") {
    signals.push({ weight: 9, reason: "user_preference" });
  }

  // Schema discovery results (describe_table carries full column info)
  const schemaDetailTools = new Set(["describe_table", "describe_view"]);
  if (msg.toolCalls?.some((tc) => schemaDetailTools.has(tc.name) && tc.status === "completed")) {
    signals.push({ weight: 8, reason: "schema_discovery" });
  }

  // ------------------------------------------------------------------
  // HIGH signals (weight 5–7)
  // ------------------------------------------------------------------

  // Find-join-path results are key for multi-table queries
  if (msg.toolCalls?.some((tc) => tc.name === "find_join_path" && tc.status === "completed")) {
    signals.push({ weight: 7, reason: "join_path_discovery" });
  }

  // Error that was later recovered from (followed by a successful run)
  if (msg.isError) {
    const idx = ctx.allMessages.findIndex((m) => m.id === msg.id);
    const later = ctx.allMessages.slice(idx + 1);
    const recovered = later.some(
      (m) => !m.isError && (m.role === "assistant" || m.toolCalls?.some((tc) => !tc.isError))
    );
    if (recovered) {
      signals.push({ weight: 6, reason: "resolved_error" });
    }
  }

  // DB entity references in content
  const entities = extractDbEntities(msg.content);
  if (entities.length > 0) {
    signals.push({
      weight: Math.min(5, entities.length + 1),
      reason: "db_references",
    });
  }

  // ------------------------------------------------------------------
  // MEDIUM signals (weight 3–4)
  // ------------------------------------------------------------------

  // Substantive assistant explanations
  if (msg.role === "assistant" && msg.content.trim().length > 150 && !isOnlyFailedToolCalls(msg)) {
    signals.push({ weight: 4, reason: "substantive_explanation" });
  }

  // Lint warnings in result (agent chose to lint and found issues)
  if (msg.toolCalls?.some((tc) => tc.name === "lint_sql_safety" && tc.status === "completed")) {
    signals.push({ weight: 3, reason: "lint_results" });
  }

  // ------------------------------------------------------------------
  // LOW signals (weight 0–2)
  // ------------------------------------------------------------------

  if (isPhatic(msg.content) && !msg.toolCalls) {
    signals.push({ weight: 1, reason: "phatic" });
  }

  // Schema listing only (no column detail) — fairly replaceable
  if (isSchemaListing(msg)) {
    signals.push({ weight: 2, reason: "schema_listing_only" });
  }

  // Only-failed tool calls with no content
  if (isOnlyFailedToolCalls(msg)) {
    signals.push({ weight: 1, reason: "failed_tool_calls_only" });
  }

  // ------------------------------------------------------------------
  // Compute final score
  // ------------------------------------------------------------------

  // Always give every message a minimum baseline weight so no message is
  // accidentally scored zero and silently discarded.
  const totalWeight = Math.max(1, signals.reduce((sum, s) => sum + s.weight, 0));

  const importance: MessageImportance =
    totalWeight >= 15
      ? "critical"
      : totalWeight >= 8
      ? "high"
      : totalWeight >= 4
      ? "medium"
      : "low";

  return {
    message: msg,
    importance,
    reasons: signals.map((s) => s.reason),
    tokens: estimateTokens(msg),
    dbEntities: entities,
    intent: classifyIntent(msg),
  };
}

export function scoreConversation(
  messages: ChatMessage[]
): ScoredMessage[] {
  const ctx: ConversationContext = { allMessages: messages };
  return messages.map((msg) => scoreMessage(msg, ctx));
}
