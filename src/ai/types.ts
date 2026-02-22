// ============================================================================
// AI Agent Framework - Types (UI & Chat Session)
// ============================================================================

import type { ModelMessage, AssistantModelMessage, ToolModelMessage } from "ai";

// Re-export provider types
export type { ProviderId, ModelConfig } from "./providers";

// --- Chat Session Types (UI) ---

export type ChatMessageRole = "user" | "assistant" | "system";

export interface ToolCallDisplay {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  status: "pending" | "running" | "completed" | "denied";
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  renderedContent?: string;
  toolCalls?: ToolCallDisplay[];
  timestamp: number;
  isError?: boolean;
}

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  sql: string;
  resolve: (approved: boolean) => void;
}

export interface ChatSession {
  id: string;
  title: string;
  modelId: string;
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

// Serializable version for persistence (no function references)
export interface ChatSessionData {
  id: string;
  title: string;
  modelId: string;
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

// ============================================================================
// Conversion: ChatMessage[] → ModelMessage[] for the AI SDK
// ============================================================================

/**
 * Convert chat history into AI SDK ModelMessage[] format.
 * Each assistant message with tool calls becomes:
 *   1. An assistant message with text + tool_call parts
 *   2. A tool message with tool result parts
 */
export function chatMessagesToModelMessages(
  messages: ChatMessage[]
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    // Skip synthetic error messages
    if (msg.isError) continue;

    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }

    // Assistant message
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Build assistant content with text + tool calls
      const assistantContent: AssistantModelMessage["content"] = [];

      if (msg.content) {
        assistantContent.push({ type: "text", text: msg.content });
      }

      for (const tc of msg.toolCalls) {
        assistantContent.push({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.input,
        });
      }

      result.push({ role: "assistant", content: assistantContent });

      // Build tool result message
      const toolContent: ToolModelMessage["content"] = [];

      for (const tc of msg.toolCalls) {
        if (tc.result !== undefined) {
          toolContent.push({
            type: "tool-result",
            toolCallId: tc.id,
            toolName: tc.name,
            output: tc.isError
              ? { type: "text", value: tc.result }
              : { type: "text", value: tc.result },
          });
        }
      }

      if (toolContent.length > 0) {
        result.push({ role: "tool", content: toolContent });
      }
    } else {
      // Simple text-only assistant message
      result.push({ role: "assistant", content: msg.content });
    }
  }

  return result;
}
