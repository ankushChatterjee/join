// ============================================================================
// Smart Context Compaction - Summarizer
// ============================================================================
//
// Generates concise, AI-produced summaries for each cluster of messages,
// using intent-tailored prompts to maximise information preservation.

import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { ChatMessage } from "@/ai/types";
import type { MessageCluster } from "./clustering";
import type { ConversationIntent } from "./scorer";
import { estimateTokensFromText } from "./utils";

// ---------------------------------------------------------------------------
// Prompt templates per intent
// ---------------------------------------------------------------------------

function buildSummarizationPrompt(cluster: MessageCluster): string {
  const intentPrompts: Record<ConversationIntent, string> = {
    schema_explore: `You are compacting a conversation log for an AI assistant's memory.
Summarize the following schema exploration segment. Preserve:
- Every table and view name mentioned (use exact names)
- Column names and their data types when they appear
- Foreign key relationships discovered
- Index information if discussed
- Any constraints or special type information

Be concise but complete. Use bullet points.`,

    query_build: `You are compacting a conversation log for an AI assistant's memory.
Summarize the following query-building segment. Preserve:
- What the user wanted to achieve
- Which tables and joins were used (with exact names)
- Key WHERE/GROUP BY/ORDER BY decisions
- Any performance considerations raised
- The final SQL if one was produced (include it verbatim in a SQL block)
- Whether the user accepted or rejected the SQL

Be concise but complete.`,

    debug: `You are compacting a conversation log for an AI assistant's memory.
Summarize the following debugging segment. Preserve:
- The original error or problem
- Root cause identified
- Solution or workaround applied
- Any SQL error messages (quote them exactly)
- The corrected SQL if produced

Be concise but complete.`,

    explain: `You are compacting a conversation log for an AI assistant's memory.
Summarize the following explanation segment. Preserve:
- What concept or query was being explained
- Key points from the explanation
- Any examples or SQL snippets used
- User's follow-up questions and answers

Be concise but complete.`,

    phatic: `You are compacting a conversation log for an AI assistant's memory.
Summarize the following casual conversation segment in one sentence.
Only include it if there was any technical content mixed in.`,

    unknown: `You are compacting a conversation log for an AI assistant's memory.
Summarize the following conversation segment. Preserve:
- User goals and requests
- Key decisions made
- Any SQL, table names, or column names mentioned
- Outcomes

Be concise but complete.`,
  };

  return intentPrompts[cluster.intent] ?? intentPrompts.unknown;
}

// ---------------------------------------------------------------------------
// Format a cluster into a text transcript for the model
// ---------------------------------------------------------------------------

function clusterToTranscript(cluster: MessageCluster): string {
  const lines: string[] = [];

  for (const sm of cluster.messages) {
    const msg = sm.message;
    const roleLabel = msg.role === "user" ? "USER" : "ASSISTANT";

    if (msg.content.trim()) {
      lines.push(`${roleLabel}: ${msg.content.trim()}`);
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        lines.push(`[TOOL CALL: ${tc.name}]`);
        if (tc.input && Object.keys(tc.input).length > 0) {
          lines.push(`  Input: ${JSON.stringify(tc.input)}`);
        }
        if (tc.result) {
          // Truncate very long tool results to avoid huge prompts
          const result = tc.result.length > 1500 ? tc.result.slice(0, 1500) + "…" : tc.result;
          lines.push(`  Result: ${result}`);
        }
        if (tc.isError) {
          lines.push(`  [ERROR]`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Summarize a single cluster
// ---------------------------------------------------------------------------

export interface ClusterSummary {
  topic: string;
  summary: string;
  originalMessageIds: string[];
  /** Estimated tokens in the summary text */
  estimatedTokens: number;
}

export async function summarizeCluster(
  cluster: MessageCluster,
  model: LanguageModel
): Promise<ClusterSummary> {
  const systemPrompt = buildSummarizationPrompt(cluster);
  const transcript = clusterToTranscript(cluster);

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: `Conversation segment to summarize:\n\n${transcript}`,
    maxOutputTokens: 600,
  });

  return {
    topic: cluster.topic,
    summary: text.trim(),
    originalMessageIds: cluster.messages.map((sm) => sm.message.id),
    estimatedTokens: estimateTokensFromText(text),
  };
}

// ---------------------------------------------------------------------------
// Build summary ChatMessage
// ---------------------------------------------------------------------------

/**
 * Converts a ClusterSummary into a system-role ChatMessage that can be
 * inserted into the compacted conversation history.
 */
export function summaryToChatMessage(summary: ClusterSummary): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "system",
    content: `[Context Summary — ${summary.topic}]\n${summary.summary}`,
    timestamp: Date.now(),
  };
}
