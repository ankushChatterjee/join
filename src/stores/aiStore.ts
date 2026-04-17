// ============================================================================
// AI Chat Store - Zustand State Management
// ============================================================================

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  ChatSession,
  ChatSessionData,
  PendingApproval,
  PendingQuestion,
  ToolCallDisplay,
  StreamingPart,
} from "@/ai/types";
import { runAgent } from "@/ai/agent";
import { encodingForModel, TiktokenModel } from "js-tiktoken";
import { buildSystemPrompt, buildMessageContext } from "@/ai/context";
import { compactConversation } from "@/ai/compaction";
import type { AgentExecutionContext } from "@/ai/executionContext";
import { resolveAgentTarget } from "@/ai/contextResolver";
import { getModelConfig } from "@/ai/modelConfigs";
import { useAppStore } from "@/stores/appStore";
import { recordPerfSample } from "@/lib/perf";

const STREAM_TEXT_FLUSH_MS = 40;
const STREAM_MARKDOWN_MIN_COMMIT_MS = 300;
const STREAM_MARKDOWN_MAX_COMMIT_MS = 800;
const DEFAULT_MODEL_ID = "gpt-5.4-mini";

const debugLog = async (message: string) => {
  try {
    await invoke("debug_log", { message });
  } catch {
    // Silently fail - debug logging is optional
  }
};

const normalizeMessageParts = (msg: ChatMessage): ChatMessage => {
  if (msg.role !== "assistant") return msg;

  if (msg.parts && msg.parts.length > 0) {
    const sortedParts = [...msg.parts].sort((a, b) => a.index - b.index);
    const isAlreadySorted = msg.parts.every((part, i) => part === sortedParts[i]);
    return isAlreadySorted ? msg : { ...msg, parts: sortedParts };
  }

  if (!msg.toolCalls || msg.toolCalls.length === 0) return msg;

  const synthesizedParts: StreamingPart[] = [];
  let index = 0;

  if (msg.content) {
    synthesizedParts.push({ type: "text", text: msg.content, index });
    index += 1;
  }

  for (const toolCall of msg.toolCalls) {
    synthesizedParts.push({ type: "tool", toolCall, index });
    index += 1;
  }

  return { ...msg, parts: synthesizedParts };
};

const normalizeSessionMessages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map(normalizeMessageParts);

interface ChatSessionMeta {
  id: string;
  title: string;
  modelId: string;
  connectionId: string | null;
  forkedFrom?: string;
  createdAt: number;
  updatedAt: number;
}

interface AiState {
  // Panel visibility
  isPanelOpen: boolean;

  // Model selection
  selectedModelId: string;

  // Session management
  sessions: ChatSessionMeta[];
  activeSessionId: string | null;
  activeSession: ChatSession | null;

  // Streaming state
  isStreaming: boolean;
  streamingTextLive: string;
  streamingTextRendered: string;
  streamingToolCalls: ToolCallDisplay[];
  streamingParts: StreamingPart[];
  abortController: AbortController | null;

  // Approval state (multiple tools may request approval concurrently)
  pendingApprovals: PendingApproval[];

  // Question state (multiple tools may request questions concurrently)
  pendingQuestions: PendingQuestion[];

  // Context Management
  tokenUsage: number;
  maxTokens: number;
  isCompacting: boolean;

  // Actions
  togglePanel: () => void;
  setSelectedModel: (modelId: string) => void;

  // Session actions
  resetProjectState: () => void;
  loadSessions: () => Promise<void>;
  createSession: () => Promise<string>;
  forkSession: (sessionId: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;

  // Chat actions
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
  approveToolCall: (toolCallId: string, approved: boolean) => void;
  answerQuestion: (toolCallId: string, answers: string[][]) => void;
  rejectQuestion: (toolCallId: string) => void;

  // Persistence
  saveActiveSession: () => Promise<void>;

  // Context Actions
  calculateTokenUsage: () => Promise<void>;
  compactContext: () => Promise<void>;
}

export const useAiStore = create<AiState>((set, get) => {
  let pendingStreamingText = "";
  let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let markdownCommitTimer: ReturnType<typeof setTimeout> | null = null;
  let nextPartIndex = 0;
  let lastMarkdownCommitAt = 0;
  let pendingTokenReceivedAt = 0;

  const getAdaptiveMarkdownCommitMs = (length: number): number => {
    if (length < 1200) return STREAM_MARKDOWN_MIN_COMMIT_MS;
    if (length < 4000) return 500;
    return STREAM_MARKDOWN_MAX_COMMIT_MS;
  };

  const commitRenderedStreamingText = (force = false) => {
    const state = get();
    if (!state.isStreaming) return;
    const now = Date.now();
    const interval = getAdaptiveMarkdownCommitMs(state.streamingTextLive.length);
    if (!force && now - lastMarkdownCommitAt < interval) return;
    if (state.streamingTextRendered === state.streamingTextLive) return;
    lastMarkdownCommitAt = now;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    set({ streamingTextRendered: state.streamingTextLive });
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordPerfSample("chat.markdown_commit_ms", endedAt - startedAt);
  };

  const scheduleMarkdownCommit = () => {
    if (markdownCommitTimer) return;
    const wait = getAdaptiveMarkdownCommitMs(get().streamingTextLive.length);
    markdownCommitTimer = setTimeout(() => {
      markdownCommitTimer = null;
      commitRenderedStreamingText(false);
      if (get().isStreaming && get().streamingTextRendered !== get().streamingTextLive) {
        scheduleMarkdownCommit();
      }
    }, wait);
  };

  const flushPendingStreamingText = () => {
    if (!pendingStreamingText) return;
    const chunk = pendingStreamingText;
    pendingStreamingText = "";
    const state = get();
    if (!state.isStreaming) return;
    if (pendingTokenReceivedAt > 0) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      recordPerfSample("chat.token_to_paint_ms", now - pendingTokenReceivedAt);
      pendingTokenReceivedAt = 0;
    }
    const nextLive = state.streamingTextLive + chunk;
    const textPartIndex = nextPartIndex;
    set((current) => {
      const parts = current.streamingParts;
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart.type === "text") {
        const merged = { ...lastPart, text: lastPart.text + chunk };
        return {
          streamingTextLive: nextLive,
          streamingParts: [...parts.slice(0, -1), merged],
        };
      }
      nextPartIndex += 1;
      return {
        streamingTextLive: nextLive,
        streamingParts: [...parts, { type: "text", text: chunk, index: textPartIndex }],
      };
    });
    const isBoundaryChunk =
      chunk.includes("```") ||
      chunk.endsWith("\n\n") ||
      /\n[-*]\s$/.test(nextLive) ||
      /\n\d+\.\s$/.test(nextLive);
    if (isBoundaryChunk) {
      commitRenderedStreamingText(true);
    } else {
      scheduleMarkdownCommit();
    }
  };

  const scheduleStreamingFlush = () => {
    if (streamFlushTimer) return;
    streamFlushTimer = setTimeout(() => {
      streamFlushTimer = null;
      flushPendingStreamingText();
    }, STREAM_TEXT_FLUSH_MS);
  };

  const resetStreamingBuffer = () => {
    pendingStreamingText = "";
    nextPartIndex = 0;
    lastMarkdownCommitAt = 0;
    pendingTokenReceivedAt = 0;
    if (streamFlushTimer) {
      clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
    if (markdownCommitTimer) {
      clearTimeout(markdownCommitTimer);
      markdownCommitTimer = null;
    }
  };

  return ({
  // Initial state
  isPanelOpen: true,
  selectedModelId: DEFAULT_MODEL_ID,
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  isStreaming: false,
  streamingTextLive: "",
  streamingTextRendered: "",
  streamingToolCalls: [],
  streamingParts: [],
  abortController: null,
  pendingApprovals: [],
  pendingQuestions: [],

  // Context Management
  tokenUsage: 0,
  maxTokens: 200000,
  isCompacting: false,

  // Toggle the AI panel
  togglePanel: () => {
    const { isPanelOpen, sessions, activeSessionId } = get();
    set({ isPanelOpen: !isPanelOpen });

    // Load sessions when opening panel if not already active
    if (!isPanelOpen && (!activeSessionId || sessions.length === 0)) {
      get().loadSessions();
    }
  },

  setSelectedModel: (modelId: string) => {
    set({ selectedModelId: modelId });
    void invoke("set_selected_model_id", { modelId }).catch((err) =>
      console.warn("Failed to persist selected model:", err)
    );
    const { activeSession } = get();
    if (!activeSession || activeSession.modelId === modelId) return;

    const updatedAt = Date.now();
    const updatedSession: ChatSession = {
      ...activeSession,
      modelId,
      updatedAt,
    };

    set((state) => ({
      activeSession: updatedSession,
      sessions: state.sessions.map((session) =>
        session.id === updatedSession.id
          ? { ...session, modelId, updatedAt }
          : session
      ),
    }));

    void get().saveActiveSession();
  },

  // Session management
  resetProjectState: () => {
    set({
      sessions: [],
      activeSessionId: null,
      activeSession: null,
      isStreaming: false,
      streamingTextLive: "",
      streamingTextRendered: "",
      streamingToolCalls: [],
      streamingParts: [],
      abortController: null,
      pendingApprovals: [],
      pendingQuestions: [],
      tokenUsage: 0,
      isCompacting: false,
    });
    resetStreamingBuffer();
  },

  loadSessions: async () => {
    try {
      const projectRoot = useAppStore.getState().activeProject?.rootPath;
      const savedModelId = await invoke<string | null>("get_selected_model_id");
      set({
        selectedModelId:
          savedModelId && getModelConfig(savedModelId)
            ? savedModelId
            : DEFAULT_MODEL_ID,
      });

      if (!projectRoot) {
        get().resetProjectState();
        return;
      }

      const sessions = await invoke<ChatSessionMeta[]>("list_chat_sessions", { projectRoot });
      set({ sessions });

      const { activeSessionId } = get();
      if (!activeSessionId) {
        if (sessions.length > 0) {
          get().loadSession(sessions[0].id);
        } else {
          get().createSession();
        }
      }
    } catch (error) {
      console.error("Failed to load chat sessions:", error);
    }
  },

  createSession: async () => {
    const projectRoot = useAppStore.getState().activeProject?.rootPath;
    if (!projectRoot) return "";
    const { selectedModelId } = get();
    const session: ChatSessionData = {
      id: crypto.randomUUID(),
      title: "New Chat",
      modelId: selectedModelId,
      connectionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    try {
      await invoke("save_chat_session", { projectRoot, session });

      const meta: ChatSessionMeta = {
        id: session.id,
        title: session.title,
        modelId: session.modelId,
        connectionId: session.connectionId,
        forkedFrom: session.forkedFrom,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };

      set((state) => ({
        sessions: [meta, ...state.sessions],
        activeSessionId: session.id,
        activeSession: { ...session },
        tokenUsage: 0,
      }));

      return session.id;
    } catch (error) {
      console.error("Failed to create chat session:", error);
      return "";
    }
  },

  forkSession: async (sessionId: string) => {
    const projectRoot = useAppStore.getState().activeProject?.rootPath;
    if (!projectRoot) return "";
    const { sessions } = get();
    
    // Find the source session
    const sourceMeta = sessions.find((s) => s.id === sessionId);
    if (!sourceMeta) {
      console.error("Source session not found for fork:", sessionId);
      return "";
    }

    try {
      // Load full session data
      const sourceSession = await invoke<ChatSession>("get_chat_session", {
        projectRoot,
        sessionId,
      });
      const normalizedSourceMessages = normalizeSessionMessages(sourceSession.messages);

      const { selectedModelId } = get();
      const newSession: ChatSessionData = {
        id: crypto.randomUUID(),
        title: sourceSession.title,
        modelId: selectedModelId,
        connectionId: sourceSession.connectionId,
        forkedFrom: sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: normalizedSourceMessages.map((msg) => ({
          ...msg,
          id: crypto.randomUUID(), // Generate new IDs for messages
        })),
      };

      await invoke("save_chat_session", {
        projectRoot,
        session: newSession,
      });

      const meta: ChatSessionMeta = {
        id: newSession.id,
        title: newSession.title,
        modelId: newSession.modelId,
        connectionId: newSession.connectionId,
        forkedFrom: newSession.forkedFrom,
        createdAt: newSession.createdAt,
        updatedAt: newSession.updatedAt,
      };

      set((state) => ({
        sessions: [meta, ...state.sessions],
        activeSessionId: newSession.id,
        activeSession: { ...newSession },
      }));

      // Calculate token usage for the forked session
      get().calculateTokenUsage();

      return newSession.id;
    } catch (error) {
      console.error("Failed to fork chat session:", error);
      return "";
    }
  },

  loadSession: async (sessionId: string) => {
    const projectRoot = useAppStore.getState().activeProject?.rootPath;
    if (!projectRoot) return;
    try {
      const session = await invoke<ChatSession>("get_chat_session", {
        projectRoot,
        sessionId,
      });
      const normalizedSession: ChatSession = {
        ...session,
        messages: normalizeSessionMessages(session.messages),
      };
      set({
        activeSessionId: sessionId,
        activeSession: normalizedSession,
      });
      // Recalculate tokens when loading a session
      get().calculateTokenUsage();
    } catch (error) {
      console.error("Failed to load chat session:", error);
    }
  },

  deleteSession: async (sessionId: string) => {
    const projectRoot = useAppStore.getState().activeProject?.rootPath;
    if (!projectRoot) return;
    try {
      await invoke("delete_chat_session", {
        projectRoot,
        sessionId,
      });
      const { activeSessionId } = get();

      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        activeSessionId:
          activeSessionId === sessionId ? null : activeSessionId,
        activeSession:
          activeSessionId === sessionId ? null : state.activeSession,
      }));
    } catch (error) {
      console.error("Failed to delete chat session:", error);
    }
  },

  setActiveSession: (sessionId: string | null) => {
    if (sessionId) {
      get().loadSession(sessionId);
    } else {
      set({ activeSessionId: null, activeSession: null });
    }
  },

  // Chat actions
  sendMessage: async (text: string) => {
    const { activeSession, selectedModelId, isStreaming } = get();

    if (isStreaming) return;
    if (!text.trim()) return;

    // Create session if needed
    let session = activeSession;
    if (!session) {
      await get().createSession();
      session = get().activeSession;
      if (!session) return;
    }

    // Check token usage and compact if necessary
    await get().calculateTokenUsage();
    if (get().tokenUsage > get().maxTokens * 0.9) {
      await get().compactContext();
    }

    const resolved = resolveAgentTarget(session.connectionId);
    let metadataWarning = resolved.blockingReason;
    let metadataIsFresh = !resolved.stale;

    if (resolved.connectionId) {
      const readiness = await useAppStore.getState().ensureMetadataReady(
        resolved.connectionId,
        1500
      );
      if (readiness.timedOut) {
        metadataWarning = `Metadata refresh timed out for ${resolved.connectionId}. Agent will verify freshness via tools.`;
        metadataIsFresh = false;
      } else {
        metadataIsFresh = true;
      }
    }

    const executionContext: AgentExecutionContext = {
      runId: crypto.randomUUID(),
      sessionId: session.id,
      targetConnectionId: resolved.connectionId,
      targetConnectionDialect: resolved.dialect,
      activeEditorKind: resolved.activeEditorKind,
      activeScriptId: resolved.activeScriptId,
      activeResultTabId: resolved.activeResultTabId,
      savedResultId: resolved.savedResultId,
      metadataVersion: resolved.connectionId
        ? useAppStore.getState().getConnectionMetadataVersion(resolved.connectionId)
        : null,
      resultVersion: resolved.resultVersion,
      capturedAt: Date.now(),
      metadataIsFresh,
      metadataWarning,
    };

    // Capture the editor/cell context snapshot at the moment of sending.
    // This is appended to the user message so each message in history carries
    // its own frozen context rather than relying on the (always-current) system prompt.
    const messageContext = buildMessageContext(executionContext);
    const rawText = text.trim();
    const fullText = messageContext ? `${rawText}${messageContext}` : rawText;

    // Log full prompt to Rust console
    await debugLog(`[AGENT] FULL PROMPT (raw: ${rawText.length}, context: ${messageContext?.length || 0}, full: ${fullText.length} chars):\n${fullText}`);

    // Add user message — store only the raw typed text
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: rawText,
      timestamp: Date.now(),
      metadata: {
        connectionId: executionContext.targetConnectionId,
        metadataVersion: executionContext.metadataVersion,
        resultTabId: executionContext.activeResultTabId,
        resultVersion: executionContext.resultVersion,
        capturedAt: executionContext.capturedAt,
      },
    };

    const updatedMessages = [...session.messages, userMessage];
    const updatedSession: ChatSession = {
      ...session,
      messages: updatedMessages,
      updatedAt: Date.now(),
      connectionId: executionContext.targetConnectionId,
      // Auto-title from first user message
      title:
        session.messages.length === 0
          ? text.trim().slice(0, 50) + (text.length > 50 ? "…" : "")
          : session.title,
    };

    set({
      activeSession: updatedSession,
      isStreaming: true,
      streamingTextLive: "",
      streamingTextRendered: "",
      streamingToolCalls: [],
      streamingParts: [],
    });
    resetStreamingBuffer();

    // Update tokens immediately for the user message
    get().calculateTokenUsage();

    // Update session title in the sessions list
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === updatedSession.id
          ? {
            ...s,
            title: updatedSession.title,
            updatedAt: updatedSession.updatedAt,
            connectionId: updatedSession.connectionId,
          }
          : s
      ),
    }));

    const abortController = new AbortController();
    set({ abortController });

    try {
      // runAgent now takes ChatMessage[] directly and converts internally
      await runAgent(
        selectedModelId,
        session.messages, // Pass raw ChatMessage[] — agent converts to ModelMessage[]
        fullText,         // Pass the full text (with context) to the model
        executionContext,
        {
          onToken: (token: string) => {
            if (pendingStreamingText.length === 0) {
              pendingTokenReceivedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
            }
            pendingStreamingText += token;
            scheduleStreamingFlush();
          },
          onToolCallStart: (toolCall) => {
            flushPendingStreamingText();
            const index = nextPartIndex++;
            const toolCallDisplay: ToolCallDisplay = {
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
              status: "running" as const,
            };
            set((state) => ({
              streamingToolCalls: [...state.streamingToolCalls, toolCallDisplay],
              streamingParts: [...state.streamingParts, { type: "tool", toolCall: toolCallDisplay, index }],
            }));
          },
          onToolCallEnd: (toolCallId, result, isError) => {
            set((state) => ({
              streamingToolCalls: state.streamingToolCalls.map((tc) =>
                tc.id === toolCallId
                  ? {
                    ...tc,
                    status: "completed" as const,
                    result,
                    isError,
                  }
                  : tc
              ),
              streamingParts: state.streamingParts.map((part) =>
                part.type === "tool" && part.toolCall.id === toolCallId
                  ? {
                    ...part,
                    toolCall: {
                      ...part.toolCall,
                      status: "completed" as const,
                      result,
                      isError,
                    },
                  }
                  : part
              ),
            }));
          },
          onRequestApproval: (approval: PendingApproval) => {
            set((state) => ({
              pendingApprovals: [...state.pendingApprovals, approval],
            }));
          },
          onRequestQuestion: (question) => {
            set((state) => ({
              pendingQuestions: [...state.pendingQuestions, question],
            }));
          },
          onComplete: (assistantMessage: ChatMessage) => {
            flushPendingStreamingText();
            commitRenderedStreamingText(true);
            // Include tool calls from streaming state
            const toolCalls = get().streamingToolCalls;
            const parts = get().streamingParts;
            const finalContent = get().streamingTextLive || assistantMessage.content;
            const finalMessage: ChatMessage = {
              ...assistantMessage,
              content: finalContent,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              parts: parts.length > 0 ? parts : undefined,
              metadata: {
                connectionId: executionContext.targetConnectionId,
                metadataVersion: executionContext.metadataVersion,
                resultTabId: executionContext.activeResultTabId,
                resultVersion: executionContext.resultVersion,
                capturedAt: Date.now(),
              },
            };

            set((state) => {
              const session = state.activeSession;
              if (!session) return state;

              const newMessages = [...session.messages, finalMessage];
              const newSession: ChatSession = {
                ...session,
                messages: newMessages,
                updatedAt: Date.now(),
              };

              return {
                activeSession: newSession,
                isStreaming: false,
                streamingTextLive: "",
                streamingTextRendered: "",
                streamingToolCalls: [],
                streamingParts: [],
                abortController: null,
                pendingApprovals: [],
                pendingQuestions: [],
              };
            });

            // Persist session
            get().saveActiveSession();

            // Recalculate once complete
            get().calculateTokenUsage();

            // Log response and token usage to Rust console
            debugLog(`[AGENT] RESPONSE:\n${finalMessage.content}`);
            debugLog(`[AGENT] TOKENS: ${get().tokenUsage} / ${get().maxTokens}`);

            resetStreamingBuffer();
          },
          onError: (error: Error) => {
            flushPendingStreamingText();
            console.error("[AI Store] Agent onError callback:", error, typeof error);

            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: errorMsg || "An unknown error occurred",
              timestamp: Date.now(),
              isError: true,
            };

            set((state) => {
              const session = state.activeSession;
              if (!session) return state;

              return {
                activeSession: {
                  ...session,
                  messages: [...session.messages, errorMessage],
                  updatedAt: Date.now(),
                },
                isStreaming: false,
                streamingTextLive: "",
                streamingTextRendered: "",
                streamingToolCalls: [],
                streamingParts: [],
                abortController: null,
                pendingApprovals: [],
                pendingQuestions: [],
              };
            });

            get().saveActiveSession();
            get().calculateTokenUsage();
            resetStreamingBuffer();
          },
        },
        abortController.signal
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isAborted = errorMsg === "Aborted" || (error instanceof DOMException && error.name === "AbortError");

      if (!isAborted) {
        console.error("[AI Store] Agent caught error:", error, typeof error, "message:", errorMsg);

        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: errorMsg || "An unknown error occurred",
          timestamp: Date.now(),
          isError: true,
        };

        set((state) => {
          const session = state.activeSession;
          if (!session) return state;

          return {
            activeSession: {
              ...session,
              messages: [...session.messages, errorMessage],
              updatedAt: Date.now(),
            },
            isStreaming: false,
            streamingTextLive: "",
            streamingTextRendered: "",
            streamingToolCalls: [],
            streamingParts: [],
            abortController: null,
            pendingApprovals: [],
            pendingQuestions: [],
          };
        });

        get().saveActiveSession();
        get().calculateTokenUsage();
        resetStreamingBuffer();
      } else {
        // Reject any pending approvals and questions on abort
        for (const a of get().pendingApprovals) {
          a.resolve(false);
        }
        for (const q of get().pendingQuestions) {
          q.reject();
        }
        set({
          isStreaming: false,
          streamingTextLive: "",
          streamingTextRendered: "",
          streamingToolCalls: [],
          streamingParts: [],
          abortController: null,
          pendingApprovals: [],
          pendingQuestions: [],
        });
        resetStreamingBuffer();
      }
    }
  },

  stopStreaming: () => {
    const { abortController, pendingApprovals, pendingQuestions } = get();
    // Reject all pending approvals and questions
    for (const a of pendingApprovals) {
      a.resolve(false);
    }
    for (const q of pendingQuestions) {
      q.reject();
    }
    abortController?.abort();
    set({
      isStreaming: false,
      streamingTextLive: "",
      streamingTextRendered: "",
      abortController: null,
      pendingApprovals: [],
      pendingQuestions: [],
      streamingParts: [],
    });
    resetStreamingBuffer();
  },

  approveToolCall: (toolCallId: string, approved: boolean) => {
    const { pendingApprovals } = get();
    const target = pendingApprovals.find((a) => a.toolCallId === toolCallId);
    if (target) {
      target.resolve(approved);
      set({
        pendingApprovals: pendingApprovals.filter((a) => a.toolCallId !== toolCallId),
      });
    }
  },

  answerQuestion: (toolCallId: string, answers: string[][]) => {
    const { pendingQuestions } = get();
    const target = pendingQuestions.find((q) => q.toolCallId === toolCallId);
    if (target) {
      target.resolve(answers);
      set({
        pendingQuestions: pendingQuestions.filter((q) => q.toolCallId !== toolCallId),
      });
    }
  },

  rejectQuestion: (toolCallId: string) => {
    const { pendingQuestions } = get();
    const target = pendingQuestions.find((q) => q.toolCallId === toolCallId);
    if (target) {
      target.reject();
      set({
        pendingQuestions: pendingQuestions.filter((q) => q.toolCallId !== toolCallId),
      });
    }
  },

  saveActiveSession: async () => {
    const { activeSession } = get();
    const projectRoot = useAppStore.getState().activeProject?.rootPath;
    if (!activeSession || !projectRoot) return;

    try {
      await invoke("save_chat_session", { projectRoot, session: activeSession });
    } catch (error) {
      console.error("Failed to save chat session:", error);
    }
  },

  calculateTokenUsage: async () => {
    const { activeSession, selectedModelId } = get();
    if (!activeSession) return;

    try {
      // Use a generic model for encoding if specific one fails or is custom
      const modelKey = selectedModelId.includes("claude") ? "gpt-4" : "gpt-4";
      // Note: Anthropic doesn't have a public tokenizer that matches perfectly in JS, 
      // but gpt-4 is a decent approximation for length. 
      // ideally we would use a specific anthropic tokenizer if available.

      const enc = encodingForModel(modelKey as TiktokenModel);

      const systemPrompt = buildSystemPrompt();
      let count = enc.encode(systemPrompt).length;

      for (const msg of activeSession.messages) {
        count += enc.encode(msg.content).length;
        if (msg.toolCalls) {
          for (const tool of msg.toolCalls) {
            count += enc.encode(JSON.stringify(tool)).length;
          }
        }
      }

      set({ tokenUsage: count });
    } catch (e) {
      console.error("Failed to calculate token usage:", e);
    }
  },

  compactContext: async () => {
    set({ isCompacting: true });
    const { activeSession, selectedModelId } = get();
    if (!activeSession || activeSession.messages.length < 8) {
      set({ isCompacting: false });
      return;
    }

    try {
      const { getModel } = await import("@/ai/providers");
      const model = await getModel(selectedModelId);

      const result = await compactConversation(
        activeSession.messages,
        model,
        {
          // Target 40% of current token usage
          targetFraction: 0.4,
          // Always keep the 6 most recent messages verbatim
          recentWindowSize: 6,
        }
      );

      console.log(
        `[AI Store] Compaction complete: ` +
        `${result.stats.originalMessages} → ${result.messages.length} messages, ` +
        `${result.stats.summariesGenerated} summaries generated, ` +
        `saved ~${result.stats.estimatedSavedTokens} tokens`
      );

      const newSession: ChatSession = {
        ...activeSession,
        messages: result.messages,
        updatedAt: Date.now(),
      };

      set({ activeSession: newSession });
      get().saveActiveSession();
      get().calculateTokenUsage();
    } catch (e) {
      console.error("[AI Store] Context compaction failed:", e);
    } finally {
      set({ isCompacting: false });
    }
  }
  });
});
