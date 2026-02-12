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
  MessageSquare,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiStore } from "@/stores/aiStore";
import { ChatMessageComponent } from "./ChatMessage";
import { getModelsByProvider, MODEL_CONFIGS } from "@/ai/providers";

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
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded text-[11px] outline-none transition-colors",
          isOpen
            ? "bg-base-750 text-base-200"
            : "text-base-400 hover:text-base-300 hover:bg-base-800/60"
        )}
      >
        <span className="truncate max-w-[130px]">
          {selectedModel?.name || "Select model"}
        </span>
        <ChevronDown className="w-3 h-3 text-base-500" />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-52 bg-base-850 border border-base-700/60 rounded-lg shadow-xl shadow-black/50 z-50 overflow-hidden animate-dropdown-in">
          {providers.map((provider) => (
            <div key={provider.providerId}>
              <div className="px-3 py-1 text-[10px] font-medium text-base-500 uppercase tracking-wider">
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
                    "w-full px-3 py-1.5 text-left text-[11px] outline-none transition-colors flex items-center gap-2",
                    model.id === selectedModelId
                      ? "bg-base-800/80 text-base-200"
                      : "text-base-300 hover:bg-base-800/50 hover:text-base-200"
                  )}
                >
                  <span className="flex-1">{model.name}</span>
                  {model.id === selectedModelId && (
                    <span className="text-base-400 text-[10px]">✓</span>
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
    <div className="absolute inset-0 bg-base-850 z-10 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-800">
        <span className="text-[11px] font-medium text-base-300">History</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleNewChat}
            className="p-1 rounded outline-none hover:bg-base-800/60 text-base-500 hover:text-base-300 transition-colors"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded outline-none hover:bg-base-800/60 text-base-500 hover:text-base-300 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto sidebar-scroll">
        {sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-base-500 text-[11px]">
            No conversations yet
          </div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleSelect(session.id)}
              className={cn(
                "w-full px-3 py-2 text-left outline-none transition-colors group flex items-center gap-2",
                session.id === activeSessionId
                  ? "bg-base-800/40"
                  : "hover:bg-base-800/25"
              )}
            >
              <MessageSquare className="w-3 h-3 text-base-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-base-300 truncate">{session.title}</p>
                <p className="text-[10px] text-base-500 mt-0.5">
                  {new Date(session.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(e, session.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded outline-none text-base-500 hover:text-red-400/80 transition-all shrink-0"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </button>
          ))
        )}
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
    pendingApproval,
    sendMessage,
    stopStreaming,
    createSession,
  } = useAiStore();

  const [inputText, setInputText] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages, streamingText, streamingToolCalls]);

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

  const messages = activeSession?.messages || [];

  return (
    <div className="ai-chat-panel h-full flex flex-col bg-surface relative">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-base-800 shrink-0">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className={cn(
              "p-1 rounded outline-none transition-colors",
              showSessions
                ? "bg-base-750 text-base-300"
                : "text-base-500 hover:text-base-300 hover:bg-base-800/60"
            )}
            title="Chat history"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNewChat}
            className="p-1 rounded outline-none text-base-500 hover:text-base-300 hover:bg-base-800/60 transition-colors"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <ModelSelector />
      </div>

      {/* Session list overlay */}
      {showSessions && (
        <SessionList onClose={() => setShowSessions(false)} />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {messages.length === 0 && !isStreaming ? (
          <div className="h-full flex flex-col items-center justify-center px-6">
            <div className="w-9 h-9 rounded-lg bg-base-800/40 flex items-center justify-center mb-3">
              <Sparkles className="w-4 h-4 text-base-500" />
            </div>
            <p className="text-[11px] text-base-400 text-center max-w-[200px] leading-relaxed">
              Ask about your database, write queries, or explore schema
            </p>
          </div>
        ) : (
          <div className="py-1">
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
                pendingApproval={pendingApproval}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-1.5 shrink-0">
        <div className="relative rounded-lg bg-base-800/50 border border-base-700/20">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            disabled={isStreaming && !pendingApproval}
            rows={1}
            className="w-full pl-3 pr-11 pt-[9px] pb-[7px] bg-transparent text-[13px] leading-normal text-base-200 placeholder:text-base-600 focus:outline-none resize-none disabled:opacity-40"
          />
          <div className="absolute right-1.5 bottom-1.5 flex items-center">
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="w-7 h-7 flex items-center justify-center rounded-md outline-none bg-base-700/40 text-base-300 hover:text-red-400 hover:bg-base-700/60 transition-colors"
                title="Stop"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputText.trim()}
                className={cn(
                  "w-7 h-7 flex items-center justify-center rounded-md outline-none transition-colors",
                  inputText.trim()
                    ? "bg-base-700/40 text-base-300 hover:text-base-100 hover:bg-base-700/60"
                    : "text-base-700 cursor-default"
                )}
                title="Send (Enter)"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
