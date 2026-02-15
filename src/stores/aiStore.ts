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
  ToolCallDisplay,
} from "@/ai/types";
import { runAgent } from "@/ai/agent";

interface ChatSessionMeta {
  id: string;
  title: string;
  modelId: string;
  connectionId: string | null;
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
  streamingText: string;
  streamingToolCalls: ToolCallDisplay[];
  abortController: AbortController | null;

  // Approval state (multiple tools may request approval concurrently)
  pendingApprovals: PendingApproval[];

  // Actions
  togglePanel: () => void;
  setSelectedModel: (modelId: string) => void;

  // Session actions
  loadSessions: () => Promise<void>;
  createSession: () => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;

  // Chat actions
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
  approveToolCall: (toolCallId: string, approved: boolean) => void;

  // Persistence
  saveActiveSession: () => Promise<void>;
}

export const useAiStore = create<AiState>((set, get) => ({
  // Initial state
  isPanelOpen: false,
  selectedModelId: "claude-sonnet-4-5-20250929",
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  isStreaming: false,
  streamingText: "",
  streamingToolCalls: [],
  abortController: null,
  pendingApprovals: [],

  // Toggle the AI panel
  togglePanel: () => {
    const { isPanelOpen, sessions, activeSessionId } = get();
    set({ isPanelOpen: !isPanelOpen });

    // Load sessions when opening panel for the first time
    if (!isPanelOpen && sessions.length === 0) {
      get().loadSessions();
    }

    // Create a session if none exists
    if (!isPanelOpen && !activeSessionId) {
      get().loadSessions().then(() => {
        if (get().sessions.length === 0) {
          get().createSession();
        } else if (!get().activeSessionId) {
          // Load the most recent session
          get().loadSession(get().sessions[0].id);
        }
      });
    }
  },

  setSelectedModel: (modelId: string) => {
    set({ selectedModelId: modelId });
  },

  // Session management
  loadSessions: async () => {
    try {
      const sessions = await invoke<ChatSessionMeta[]>("list_chat_sessions");
      set({ sessions });
    } catch (error) {
      console.error("Failed to load chat sessions:", error);
    }
  },

  createSession: async () => {
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
      await invoke("save_chat_session", { session });

      const meta: ChatSessionMeta = {
        id: session.id,
        title: session.title,
        modelId: session.modelId,
        connectionId: session.connectionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };

      set((state) => ({
        sessions: [meta, ...state.sessions],
        activeSessionId: session.id,
        activeSession: { ...session },
      }));

      return session.id;
    } catch (error) {
      console.error("Failed to create chat session:", error);
      return "";
    }
  },

  loadSession: async (sessionId: string) => {
    try {
      const session = await invoke<ChatSession>("get_chat_session", {
        sessionId,
      });
      set({
        activeSessionId: sessionId,
        activeSession: session,
      });
    } catch (error) {
      console.error("Failed to load chat session:", error);
    }
  },

  deleteSession: async (sessionId: string) => {
    try {
      await invoke("delete_chat_session", { sessionId });
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

    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };

    const updatedMessages = [...session.messages, userMessage];
    const updatedSession: ChatSession = {
      ...session,
      messages: updatedMessages,
      updatedAt: Date.now(),
      // Auto-title from first user message
      title:
        session.messages.length === 0
          ? text.trim().slice(0, 50) + (text.length > 50 ? "…" : "")
          : session.title,
    };

    set({
      activeSession: updatedSession,
      isStreaming: true,
      streamingText: "",
      streamingToolCalls: [],
    });

    // Update session title in the sessions list
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === updatedSession.id
          ? { ...s, title: updatedSession.title, updatedAt: updatedSession.updatedAt }
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
        text.trim(),
        {
          onToken: (token: string) => {
            set((state) => ({
              streamingText: state.streamingText + token,
            }));
          },
          onToolCallStart: (toolCall) => {
            set((state) => ({
              streamingToolCalls: [
                ...state.streamingToolCalls,
                {
                  id: toolCall.id,
                  name: toolCall.name,
                  input: toolCall.input,
                  status: "running" as const,
                },
              ],
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
            }));
          },
          onRequestApproval: (approval: PendingApproval) => {
            set((state) => ({
              pendingApprovals: [...state.pendingApprovals, approval],
            }));
          },
          onComplete: (assistantMessage: ChatMessage) => {
            // Include tool calls from streaming state
            const toolCalls = get().streamingToolCalls;
            const finalMessage: ChatMessage = {
              ...assistantMessage,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
                streamingText: "",
                streamingToolCalls: [],
                abortController: null,
                pendingApprovals: [],
              };
            });

            // Persist session
            get().saveActiveSession();
          },
          onError: (error: Error) => {
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
                streamingText: "",
                streamingToolCalls: [],
                abortController: null,
                pendingApprovals: [],
              };
            });

            get().saveActiveSession();
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
            streamingText: "",
            streamingToolCalls: [],
            abortController: null,
            pendingApprovals: [],
          };
        });

        get().saveActiveSession();
      } else {
        // Reject any pending approvals on abort
        for (const a of get().pendingApprovals) {
          a.resolve(false);
        }
        set({
          isStreaming: false,
          streamingText: "",
          streamingToolCalls: [],
          abortController: null,
          pendingApprovals: [],
        });
      }
    }
  },

  stopStreaming: () => {
    const { abortController, pendingApprovals } = get();
    // Reject all pending approvals
    for (const a of pendingApprovals) {
      a.resolve(false);
    }
    abortController?.abort();
    set({
      isStreaming: false,
      abortController: null,
      pendingApprovals: [],
    });
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

  // Persistence
  saveActiveSession: async () => {
    const { activeSession } = get();
    if (!activeSession) return;

    try {
      await invoke("save_chat_session", { session: activeSession });
    } catch (error) {
      console.error("Failed to save chat session:", error);
    }
  },
}));
