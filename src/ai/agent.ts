// ============================================================================
// AI Agent - Core Loop (Vercel AI SDK)
// ============================================================================

import { streamText, stepCountIs } from "ai";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ToolCallDisplay, PendingApproval } from "./types";
import { chatMessagesToModelMessages } from "./types";
import { getModel, getModelConfig } from "./providers";
import { allTools } from "./tools";
import { buildSystemPrompt } from "./context";
import type { AgentExecutionContext } from "./executionContext";

const debugLog = async (message: string) => {
  try {
    await invoke("debug_log", { message });
  } catch {
    // Silently fail - debug logging is optional
  }
};

const MAX_TOOL_ITERATIONS = 15;

// --- Agent Context (passed to tools via experimental_context) ---

export interface AgentContext {
  onRequestApproval?: (approval: PendingApproval) => void;
  executionContext: AgentExecutionContext;
}

// --- Agent Callbacks ---

export interface AgentCallbacks {
  onToken: (text: string) => void;
  onToolCallStart: (toolCall: { id: string; name: string; input: Record<string, unknown> }) => void;
  onToolCallEnd: (toolCallId: string, result: string, isError?: boolean) => void;
  onRequestApproval: (approval: PendingApproval) => void;
  onComplete: (message: ChatMessage) => void;
  onError: (error: Error) => void;
}

/**
 * Run the agent loop for a given user message.
 * Uses Vercel AI SDK streamText with automatic tool execution.
 */
export async function runAgent(
  modelId: string,
  conversationHistory: ChatMessage[],
  userText: string,
  executionContext: AgentExecutionContext,
  callbacks: AgentCallbacks,
  signal?: AbortSignal
): Promise<ChatMessage> {
  // Get the AI SDK model instance (lazily creates provider with API key)
  const model = await getModel(modelId);
  const modelConfig = getModelConfig(modelId);
  const systemPrompt = buildSystemPrompt(executionContext);

  // Log system prompt to Rust console
  await debugLog(`[AGENT] SYSTEM PROMPT (${systemPrompt.length} chars):\n${systemPrompt}`);

  // Convert chat history to AI SDK ModelMessage format
  const messages = chatMessagesToModelMessages(conversationHistory);

  // Context object passed to all tool execute() calls
  const agentContext: AgentContext = {
    onRequestApproval: callbacks.onRequestApproval,
    executionContext,
  };

  // Track all tool calls for the final ChatMessage
  const allToolCalls: ToolCallDisplay[] = [];
  let accumulatedText = "";

  // Run streamText with the agentic loop
  const result = streamText({
    model,
    system: systemPrompt,
    messages: [
      ...messages,
      { role: "user" as const, content: userText },
    ],
    tools: allTools,
    maxOutputTokens: modelConfig?.maxOutputTokens,
    stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
    abortSignal: signal,
    experimental_context: agentContext,
    onStepFinish: (step) => {
      console.log(
        `[Agent] Step finished — finishReason: ${step.finishReason}, ` +
        `usage: ${JSON.stringify(step.usage)}`
      );
    },
    onFinish: (event) => {
      console.log(
        `[Agent] Completed — totalUsage: ${JSON.stringify(event.totalUsage)}, ` +
        `steps: ${event.steps.length}, toolCalls: ${allToolCalls.length}`
      );
    },
    onError: (event) => {
      console.error("[Agent] Stream error:", event.error);
    },
  });

  // Iterate the full stream for granular events
  try {
    for await (const part of result.fullStream) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      switch (part.type) {
        case "text-delta": {
          accumulatedText += part.text;
          callbacks.onToken(part.text);
          break;
        }

        case "tool-call": {
          // A tool call has been fully parsed — record it
          const toolInput = (part.input ?? {}) as Record<string, unknown>;
          const display: ToolCallDisplay = {
            id: part.toolCallId,
            name: part.toolName,
            input: toolInput,
            status: "running",
          };
          allToolCalls.push(display);
          callbacks.onToolCallStart({
            id: part.toolCallId,
            name: part.toolName,
            input: toolInput,
          });
          break;
        }

        case "tool-result": {
          // Tool execution finished
          const tc = allToolCalls.find((t) => t.id === part.toolCallId);
          const outputStr = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
          if (tc) {
            tc.status = "completed";
            tc.result = outputStr;
            tc.isError = false;
          }
          callbacks.onToolCallEnd(
            part.toolCallId,
            outputStr,
            false
          );
          break;
        }

        case "tool-error": {
          // Tool execution errored
          const tc2 = allToolCalls.find((t) => t.id === part.toolCallId);
          const errorMsg = part.error instanceof Error ? part.error.message : String(part.error);
          if (tc2) {
            tc2.status = "completed";
            tc2.result = errorMsg;
            tc2.isError = true;
          }
          callbacks.onToolCallEnd(part.toolCallId, errorMsg, true);
          break;
        }

        case "error": {
          throw part.error instanceof Error
            ? part.error
            : new Error(String(part.error));
        }

        // Ignore other stream events (start-step, finish-step, etc.)
        default:
          break;
      }
    }
  } catch (err) {
    // If aborted, rethrow
    if (signal?.aborted || (err instanceof Error && err.message === "Aborted")) {
      throw new Error("Aborted");
    }
    throw err;
  }

  // Build the final ChatMessage
  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: accumulatedText,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    timestamp: Date.now(),
  };

  callbacks.onComplete(assistantMessage);
  return assistantMessage;
}
