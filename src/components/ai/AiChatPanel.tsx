// ============================================================================
// AI Chat Panel - Main UI Component
// ============================================================================

import { useState, useRef, useEffect, useCallback, memo } from "react";
import {
  Send,
  Square,
  Plus,
  Trash2,
  ChevronDown,
  Check,
  MessageSquare,
  X,
  Sparkles,
  GitFork,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiStore } from "@/stores/aiStore";
import { ChatMessageComponent } from "./ChatMessage";
import { getModelsByProvider, MODEL_CONFIGS } from "@/ai/modelConfigs";
import type { ProviderId } from "@/ai/modelConfigs";
import { useShallow } from "zustand/react/shallow";

function formatSessionTimestamp(timestamp: number): string {
  const now = Date.now();
  const minutes = Math.floor((now - timestamp) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const date = new Date(timestamp);
  const isCurrentYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(isCurrentYear ? {} : { year: "numeric" }),
  });
}

// --- Model Selector ---

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google",
  moonshotai: "Moonshot",
  zai: "Z.AI",
};

function ModelSelector() {
  const { selectedModelId, setSelectedModel } = useAiStore(
    useShallow((state) => ({
      selectedModelId: state.selectedModelId,
      setSelectedModel: state.setSelectedModel,
    }))
  );
  const [isOpen, setIsOpen] = useState(false);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<ProviderId>>(() => new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  const providers = getModelsByProvider();
  const selectedModel = MODEL_CONFIGS.find((m) => m.id === selectedModelId);
  const selectedProviderName = selectedModel ? PROVIDER_LABELS[selectedModel.providerId] : null;

  const toggleProvider = (providerId: ProviderId) => {
    setCollapsedProviders((previous) => {
      const next = new Set(previous);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Select model"
        className={cn(
          "flex h-8 min-w-[168px] items-center gap-2 rounded-sm border px-2 text-left outline-none transition-colors-fast",
          isOpen
            ? "border-accent-500/40 bg-base-850 text-base-50 shadow-sm shadow-black/20"
            : "border-base-750 bg-base-900/80 text-base-200 hover:border-base-600 hover:bg-base-850 hover:text-base-50"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold leading-3">
            {selectedModel?.name || "Select model"}
          </span>
          <span className="mt-0.5 block truncate text-[10px] leading-3 text-base-400">
            {selectedProviderName || "Provider"}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-base-300 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="animate-dropdown-in absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-md border border-base-700 bg-base-950/98 shadow-xl shadow-black/35">
          <div className="border-b border-base-750 bg-base-900 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-300">
                  Model
                </div>
                <div className="mt-0.5 truncate text-[12px] text-base-100">
                  Choose the model for this chat
                </div>
              </div>
              {selectedProviderName ? (
                <span className="shrink-0 text-[11px] font-medium text-base-300">
                  {selectedProviderName}
                </span>
              ) : null}
            </div>
          </div>
          {providers.map((provider) => {
            const isProviderCollapsed = collapsedProviders.has(provider.providerId);

            return (
              <div
                key={provider.providerId}
                className="border-b border-base-800/80 px-2 py-1 last:border-b-0"
              >
                <button
                  onClick={() => toggleProvider(provider.providerId)}
                  className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left transition-colors-fast hover:bg-base-850"
                  aria-expanded={!isProviderCollapsed}
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 text-base-400 transition-transform duration-150",
                      !isProviderCollapsed && "rotate-90"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-base-200">
                    {PROVIDER_LABELS[provider.providerId]}
                  </span>
                  <span className="shrink-0 text-[11px] text-base-400">
                    {provider.models.length} model{provider.models.length === 1 ? "" : "s"}
                  </span>
                </button>
                {!isProviderCollapsed ? provider.models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      setSelectedModel(model.id);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors-fast",
                      model.id === selectedModelId
                        ? "bg-accent-500/10 text-base-50 ring-1 ring-accent-500/25"
                        : "text-base-300 hover:bg-base-850 hover:text-base-100"
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        model.id === selectedModelId
                          ? "bg-accent-400"
                          : "bg-base-600 group-hover:bg-base-400"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium leading-4">
                        {model.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] leading-3 text-base-400">
                        {model.id}
                      </span>
                    </span>
                    {model.id === selectedModelId ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-accent-300" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                  </button>
                )) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Session List Sidebar ---

function SessionList({ onClose }: { onClose: () => void }) {
  const { sessions, activeSessionId, createSession, deleteSession, setActiveSession } =
    useAiStore(
      useShallow((state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        createSession: state.createSession,
        deleteSession: state.deleteSession,
        setActiveSession: state.setActiveSession,
      }))
    );

  const handleNewChat = async () => {
    await createSession();
    onClose();
  };

  const handleSelect = (sessionId: string) => {
    setActiveSession(sessionId);
    onClose();
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-base-900/96">
      <div className="flex items-center justify-between border-b border-base-750 px-2.5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-base-300">
          Chat History
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="border border-base-700 p-1 text-base-300 outline-none transition-colors-fast hover:border-base-600 hover:bg-base-800 hover:text-base-100"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="border border-base-700 p-1 text-base-300 outline-none transition-colors-fast hover:border-base-600 hover:bg-base-800 hover:text-base-100"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto sidebar-scroll">
        {sessions.length === 0 ? (
          <div className="px-3 py-7 text-center text-[11px] text-base-300">
            No conversations yet
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group flex items-center gap-1.5 border-b border-base-800/60 px-1.5 py-1.5 transition-colors-fast",
                session.id === activeSessionId
                  ? "bg-base-850"
                  : "hover:bg-base-850/70"
              )}
            >
              <button
                onClick={() => handleSelect(session.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1 text-left outline-none"
              >
                <MessageSquare className="h-3 w-3 shrink-0 text-base-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-base-200">{session.title}</p>
                  <p className="mt-0.5 text-[11px] text-base-300">
                    {formatSessionTimestamp(session.updatedAt)}
                  </p>
                </div>
              </button>
              <button
                onClick={(e) => handleDelete(e, session.id)}
                className="shrink-0 p-1 text-base-400 opacity-0 outline-none transition-all group-hover:opacity-100 hover:bg-base-800 hover:text-red-300"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Token Usage Indicator ---

function TokenUsageBar() {
  const { tokenUsage, maxTokens, isCompacting } = useAiStore(
    useShallow((state) => ({
      tokenUsage: state.tokenUsage,
      maxTokens: state.maxTokens,
      isCompacting: state.isCompacting,
    }))
  );
  const percentage = Math.min(100, Math.max(0, (tokenUsage / maxTokens) * 100));

  const totalSegments = 20; // Reduced segments for smaller size
  const activeSegments = tokenUsage > 0
    ? Math.max(1, Math.round((percentage / 100) * totalSegments))
    : 0;

  return (
    <div className="flex items-center gap-2" title={`${Math.round(tokenUsage / 1000)}k / ${Math.round(maxTokens / 1000)}k tokens`}>
      <span className={cn("text-[11px] uppercase font-mono tracking-[0.08em] text-base-300", isCompacting && "animate-pulse text-accent-400")}>
        {isCompacting ? "COMPACTING..." : `${Math.round(tokenUsage / 1000)}k`}
      </span>
      <div className="flex gap-[1px] h-[3px] w-[60px]">
        {Array.from({ length: totalSegments }).map((_, i) => {
          const isActive = i < activeSegments;
          const isWarning = percentage >= 80;
          const isCritical = percentage >= 95;

          let bgColor = "bg-base-800/60";
          if (isActive) {
            if (isCritical) bgColor = "bg-red-500 shadow-[0_0_2px_rgba(239,68,68,0.5)]";
            else if (isWarning) bgColor = "bg-orange-500 shadow-[0_0_2px_rgba(249,115,22,0.5)]";
            else bgColor = "bg-amber-400 shadow-[0_0_2px_rgba(251,191,36,0.3)]";
          }

          return (
            <div
              key={i}
              className={cn("flex-1 rounded-[1px] transition-all duration-500", bgColor)}
            />
          );
        })}
      </div>
    </div>
  );
}

// --- Main Panel ---

function AiChatPanel() {
  const {
    activeSession,
    sessions,
    isStreaming,
    streamingTextLive,
    streamingTextRendered,
    streamingToolCalls,
    streamingParts,
    pendingApprovals,
    pendingQuestions,
    sendMessage,
    stopStreaming,
    createSession,
    forkSession,
  } = useAiStore(
    useShallow((state) => ({
      activeSession: state.activeSession,
      sessions: state.sessions,
      isStreaming: state.isStreaming,
      streamingTextLive: state.streamingTextLive,
      streamingTextRendered: state.streamingTextRendered,
      streamingToolCalls: state.streamingToolCalls,
      streamingParts: state.streamingParts,
      pendingApprovals: state.pendingApprovals,
      pendingQuestions: state.pendingQuestions,
      sendMessage: state.sendMessage,
      stopStreaming: state.stopStreaming,
      createSession: state.createSession,
      forkSession: state.forkSession,
    }))
  );

  const [inputText, setInputText] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollPositionRef = useRef<number>(0);
  const lastMessageSignatureRef = useRef<string>("");
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior>("auto");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = activeSession?.messages || [];

  // Save scroll position before re-render
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      scrollPositionRef.current = el.scrollTop;
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Restore scroll position after re-render (but not when streaming)
  useEffect(() => {
    if (isStreaming) return;
    const el = messagesContainerRef.current;
    if (el && scrollPositionRef.current > 0 && !shouldStickToBottomRef.current) {
      el.scrollTop = scrollPositionRef.current;
    }
  }, [isStreaming]);

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    pendingScrollBehaviorRef.current = behavior;
    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const anchor = bottomAnchorRef.current;
      if (anchor) {
        anchor.scrollIntoView({
          block: "end",
          behavior: pendingScrollBehaviorRef.current,
        });
        return;
      }

      const el = messagesContainerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: pendingScrollBehaviorRef.current });
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 96;
  }, []);

  const wasStreamingRef = useRef(false);

  const messageSignature = `${messages.length}:${messages[messages.length - 1]?.id ?? ""}:${isStreaming ? 1 : 0}:${streamingTextLive.length}:${streamingTextRendered.length}:${streamingToolCalls.length}:${streamingParts.length}`;

  // Auto-scroll only on chat events (new messages/stream updates), never on editor-only re-renders.
  useEffect(() => {
    if (messageSignature === lastMessageSignatureRef.current) return;
    lastMessageSignatureRef.current = messageSignature;

    // When streaming starts, always scroll to bottom initially
    if (isStreaming && !wasStreamingRef.current) {
      shouldStickToBottomRef.current = true;
      scheduleScrollToBottom("auto");
    } else if (isStreaming && shouldStickToBottomRef.current) {
      scheduleScrollToBottom("auto");
    }
    wasStreamingRef.current = isStreaming;
  }, [messageSignature, isStreaming, scheduleScrollToBottom]);

  // Fallback for async layout growth (markdown/code/table rendering): follow content size changes while streaming.
  useEffect(() => {
    const contentEl = messagesContentRef.current;
    if (!contentEl || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (isStreaming && shouldStickToBottomRef.current) {
        scheduleScrollToBottom("auto");
      }
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [isStreaming, scheduleScrollToBottom]);

  // Reset stick-to-bottom when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      shouldStickToBottomRef.current = true;
    }
  }, [isStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [inputText]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isStreaming) return;
    const text = inputText;
    setInputText("");
    await sendMessage(text);
  }, [inputText, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleNewChat = async () => {
    await createSession();
  };

  const handleForkChat = async () => {
    if (!activeSession) return;
    await forkSession(activeSession.id);
  };

  // Get the original session title if this is a forked session
  const forkedFromTitle = activeSession?.forkedFrom
    ? sessions.find((s) => s.id === activeSession.forkedFrom)?.title
    : null;

  const inputDisabled = isStreaming && pendingApprovals.length === 0;
  const canSend = inputText.trim().length > 0 && !isStreaming;

  return (
    <div className="ai-chat-panel relative flex h-full flex-col overflow-hidden bg-base-900">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-base-750 bg-base-900 px-3">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowSessions(!showSessions)}
            aria-label="Open chat history"
            className={cn(
              "w-6 h-6 flex items-center justify-center outline-none transition-colors-fast",
              showSessions
                ? "bg-base-800 text-base-100"
                : "text-base-300 hover:bg-base-800 hover:text-base-100"
            )}
            title="Chat history"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleNewChat}
            className="w-6 h-6 flex items-center justify-center text-base-300 outline-none transition-colors-fast hover:bg-base-800 hover:text-base-100"
            title="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleForkChat}
            disabled={!activeSession}
            className={cn(
              "w-6 h-6 flex items-center justify-center outline-none transition-colors-fast",
              activeSession
                ? "text-base-300 hover:bg-base-800 hover:text-base-100"
                : "text-base-500 cursor-not-allowed"
            )}
            title="Fork chat"
          >
            <GitFork className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[12px] font-semibold text-base-100">
            {activeSession?.title || "New chat"}
          </p>
          {forkedFromTitle && (
            <p className="truncate text-[11px] text-base-300">
              Forked from: {forkedFromTitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <ModelSelector />
        </div>
      </div>

      {/* Session list overlay */}
      {showSessions && (
        <SessionList onClose={() => setShowSessions(false)} />
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="sidebar-scroll flex-1 scrollbar-stable"
      >
        {messages.length === 0 && !isStreaming ? (
          <div className="mx-auto flex h-full w-full items-center justify-center px-4 pb-12">
            <Sparkles className="h-4 w-4 text-accent-400" />
          </div>
        ) : (
          <div ref={messagesContentRef} className="mx-auto w-full max-w-[1040px] px-3 py-3">
            {messages.map((msg) => (
              <ChatMessageComponent 
                key={msg.id} 
                message={msg} 
                pendingApprovals={pendingApprovals}
                pendingQuestions={pendingQuestions}
              />
            ))}

            {/* Streaming assistant message */}
            {isStreaming && (
              <ChatMessageComponent
                message={{
                  id: "streaming",
                  role: "assistant",
                  content: "",
                  timestamp: Date.now(),
                }}
                isStreaming={true}
                streamingTextLive={streamingTextLive}
                streamingTextRendered={streamingTextRendered}
                streamingToolCalls={streamingToolCalls}
                streamingParts={streamingParts}
                pendingApprovals={pendingApprovals}
                pendingQuestions={pendingQuestions}
              />
            )}
            <div ref={bottomAnchorRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-base-750 bg-base-900 px-3 pb-2 pt-2">
        <div className="relative border border-base-700 bg-base-850 transition-colors-fast focus-within:border-base-600">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            disabled={inputDisabled}
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent px-3 pb-8 pt-2 pr-12 text-[14px] leading-6 text-base-100 placeholder:text-base-400 focus:outline-none focus-visible:outline-none disabled:opacity-40"
          />
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="flex h-7 w-7 items-center justify-center bg-red-500/10 text-red-400 outline-none transition-colors-fast hover:bg-red-500/20 hover:text-red-300"
                title="Stop generating"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "flex h-7 w-7 items-center justify-center outline-none transition-colors-fast",
                  canSend
                    ? "bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 hover:text-accent-300"
                    : "bg-base-800 text-base-500 cursor-not-allowed"
                )}
                title="Send message (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between px-0.5">
          <p className="text-[11px] text-base-200">
            <kbd className="bg-base-850 px-1 py-0.5 font-mono text-[10px] text-base-100">Enter</kbd> send
            {" · "}
            <kbd className="bg-base-850 px-1 py-0.5 font-mono text-[10px] text-base-100">Shift+Enter</kbd> new line
          </p>
          <div className="flex items-center gap-3">
            <TokenUsageBar />
            {isStreaming && (
              <p className="text-[11px] text-base-300 animate-pulse">Generating...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const MemoizedAiChatPanel = memo(AiChatPanel);
export { MemoizedAiChatPanel as AiChatPanel };
