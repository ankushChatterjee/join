// ============================================================================
// AI Chat Panel - Main UI Component
// ============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Square,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  MessageSquare,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiStore } from "@/stores/aiStore";
import { ChatMessageComponent } from "./ChatMessage";
import { getModelsByProvider, MODEL_CONFIGS } from "@/ai/providers";

const QUICK_PROMPTS = [
  "Summarize this schema and suggest naming improvements",
  "Help me write a query with safe joins and clear filters",
  "Review my SQL and suggest performance optimizations",
];

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

function ModelSelector() {
  const { selectedModelId, setSelectedModel } = useAiStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const providers = getModelsByProvider();
  const selectedModel = MODEL_CONFIGS.find((m) => m.id === selectedModelId);

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
          "flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] outline-none transition-all",
          isOpen
            ? "bg-base-800/90 text-base-100"
            : "text-base-300 hover:bg-base-800/70 hover:text-base-100"
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent-500/80" />
        <span className="max-w-[130px] truncate">
          {selectedModel?.name || "Select model"}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-base-300 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="animate-dropdown-in absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-base-700/80 bg-base-850 shadow-xl shadow-black/50">
          {providers.map((provider) => (
            <div
              key={provider.providerId}
              className="border-b border-base-700/40 last:border-b-0"
            >
              <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-base-400">
                {provider.providerName}
              </div>
              {provider.models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    setSelectedModel(model.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] outline-none transition-colors",
                    model.id === selectedModelId
                      ? "bg-base-800/80 text-base-100"
                      : "text-base-300 hover:bg-base-800/60 hover:text-base-100"
                  )}
                >
                  <span className="flex-1">{model.name}</span>
                  {model.id === selectedModelId && (
                    <Check className="h-3 w-3 text-accent-400" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Session List Sidebar ---

function SessionList({ onClose }: { onClose: () => void }) {
  const { sessions, activeSessionId, createSession, deleteSession, setActiveSession } =
    useAiStore();

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
    <div className="absolute inset-0 z-20 flex flex-col bg-base-900/96 backdrop-blur-[2px]">
      <div className="flex items-center justify-between border-b border-base-800/90 px-3 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-base-400">
          Chat History
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="rounded-md border border-base-700/70 p-1 text-base-300 outline-none transition-all hover:border-base-600 hover:bg-base-800/70 hover:text-base-100"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-base-700/70 p-1 text-base-300 outline-none transition-all hover:border-base-600 hover:bg-base-800/70 hover:text-base-100"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto sidebar-scroll">
        {sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11px] text-base-300">
            No conversations yet
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group flex items-center gap-1.5 border-b border-base-800/30 px-2 py-1.5 transition-colors",
                session.id === activeSessionId
                  ? "bg-base-800/45"
                  : "hover:bg-base-800/30"
              )}
            >
              <button
                onClick={() => handleSelect(session.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left outline-none"
              >
                <MessageSquare className="h-3 w-3 shrink-0 text-base-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-base-200">{session.title}</p>
                  <p className="mt-0.5 text-[10px] text-base-400">
                    {formatSessionTimestamp(session.updatedAt)}
                  </p>
                </div>
              </button>
              <button
                onClick={(e) => handleDelete(e, session.id)}
                className="shrink-0 rounded p-1 text-base-400 opacity-0 outline-none transition-all group-hover:opacity-100 hover:bg-base-800/70 hover:text-red-300"
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
  const { tokenUsage, maxTokens, isCompacting } = useAiStore();
  const percentage = Math.min(100, Math.max(0, (tokenUsage / maxTokens) * 100));

  const totalSegments = 20; // Reduced segments for smaller size
  const activeSegments = tokenUsage > 0
    ? Math.max(1, Math.round((percentage / 100) * totalSegments))
    : 0;

  return (
    <div className="flex items-center gap-2" title={`${Math.round(tokenUsage / 1000)}k / ${Math.round(maxTokens / 1000)}k tokens`}>
      <span className={cn("text-[10px] uppercase font-mono tracking-widest text-base-400", isCompacting && "animate-pulse text-accent-400")}>
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

export function AiChatPanel() {
  const {
    activeSession,
    isStreaming,
    streamingText,
    streamingToolCalls,
    pendingApprovals,
    sendMessage,
    stopStreaming,
    createSession,
    togglePanel,
  } = useAiStore();

  const [inputText, setInputText] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = activeSession?.messages || [];

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 96;
  }, []);

  // Auto-scroll while streaming, but only if the user is near the latest message.
  useEffect(() => {
    if (isStreaming || shouldStickToBottomRef.current) {
      scrollToBottom(isStreaming ? "auto" : "smooth");
    }
  }, [messages.length, isStreaming, streamingText, streamingToolCalls.length, scrollToBottom]);

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

  const inputDisabled = isStreaming && pendingApprovals.length === 0;
  const canSend = inputText.trim().length > 0 && !isStreaming;

  const handlePromptClick = (prompt: string) => {
    setInputText(prompt);
    inputRef.current?.focus();
  };

  return (
    <div className="ai-chat-panel relative flex h-full flex-col border-l border-base-700/20 bg-base-900">
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between gap-2 border-b border-border-subtle bg-surface/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowSessions(!showSessions)}
            aria-label="Open chat history"
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded-md outline-none transition-all",
              showSessions
                ? "bg-base-800/90 text-base-100"
                : "text-base-300 hover:bg-base-800/70 hover:text-base-100"
            )}
            title="Chat history"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleNewChat}
            className="w-7 h-7 flex items-center justify-center rounded-md text-base-300 outline-none transition-all hover:bg-base-800/70 hover:text-base-100"
            title="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-xs font-medium text-base-200">
            {activeSession?.title || "New chat"}
          </p>
        </div>

        <div className="flex items-center gap-0.5">
          <ModelSelector />
          <button
            onClick={togglePanel}
            aria-label="Collapse AI panel"
            className="w-7 h-7 flex items-center justify-center rounded-md text-base-300 outline-none transition-all hover:bg-base-800/70 hover:text-base-100"
            title="Collapse AI panel"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
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
        className="sidebar-scroll flex-1 overflow-y-auto"
      >
        {messages.length === 0 && !isStreaming ? (
          <div className="mx-auto flex h-full w-full max-w-[760px] flex-col items-center justify-center px-5 pb-14">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-base-700/70 bg-base-850/90">
              <Sparkles className="h-4 w-4 text-accent-400" />
            </div>
            <p className="max-w-[250px] text-center text-[12px] leading-relaxed text-base-300">
              Ask about your database, write queries, or explore schema
            </p>
            <div className="mt-5 grid w-full max-w-[340px] gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handlePromptClick(prompt)}
                  className="rounded-lg border border-base-700/60 bg-base-850/70 px-3 py-2 text-left text-[11px] text-base-300 outline-none transition-all hover:border-base-600 hover:bg-base-800/80 hover:text-base-100"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[760px] px-2.5 py-3">
            {messages.map((msg) => (
              <ChatMessageComponent key={msg.id} message={msg} />
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
                streamingText={streamingText}
                streamingToolCalls={streamingToolCalls}
                pendingApprovals={pendingApprovals}
              />
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-base-800/50 bg-base-900/95 px-2.5 pb-2.5 pt-2">
        <div className="relative rounded-2xl bg-base-850/95 shadow-[0_12px_30px_-24px_rgba(0,0,0,0.95)] transition-[background-color,box-shadow] duration-200 hover:bg-base-850 focus-within:bg-base-800/95 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_36px_-24px_rgba(0,0,0,1)]">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            disabled={inputDisabled}
            rows={1}
            className="w-full resize-none bg-transparent px-3.5 pb-9 pt-3 pr-14 text-[13px] leading-[1.5] text-base-100 placeholder:text-base-400 focus:outline-none focus-visible:outline-none disabled:opacity-40"
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10 text-red-400 outline-none transition-all hover:bg-red-500/20 hover:text-red-300"
                title="Stop generating"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl outline-none transition-all",
                  canSend
                    ? "bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 hover:text-accent-300"
                    : "bg-base-800/30 text-base-500 cursor-not-allowed"
                )}
                title="Send message (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1">
          <p className="text-[10px] text-base-300">
            <kbd className="rounded bg-base-850/90 px-1 py-0.5 font-mono text-[9px] text-base-100">Enter</kbd> send
            {" · "}
            <kbd className="rounded bg-base-850/90 px-1 py-0.5 font-mono text-[9px] text-base-100">Shift+Enter</kbd> new line
          </p>
          <div className="flex items-center gap-3">
            <TokenUsageBar />
            {isStreaming && (
              <p className="text-[10px] text-base-400 animate-pulse">Generating...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
