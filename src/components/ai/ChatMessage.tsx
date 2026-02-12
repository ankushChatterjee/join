// ============================================================================
// Chat Message Component
// ============================================================================

import type { ReactNode } from "react";
import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Loader2,
  ShieldAlert,
  Copy,
  ArrowDownToLine,
  Wrench,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiStore } from "@/stores/aiStore";
import { insertTextAtCursor } from "@/components/editor/editorUtils";
import type { ChatMessage as ChatMessageType, ToolCallDisplay, PendingApproval } from "@/ai/types";

// --- Simple Markdown Renderer ---

function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = "";
  let blockIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <CodeBlock
            key={`code-${blockIndex++}`}
            code={codeBlockContent.join("\n")}
            language={codeBlockLang}
          />
        );
        inCodeBlock = false;
        codeBlockContent = [];
        codeBlockLang = "";
      } else {
        // Start code block
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm font-semibold text-base-100 mt-3 mb-1">
          {line.slice(4)}
        </h3>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-sm font-semibold text-base-100 mt-3 mb-1">
          {line.slice(3)}
        </h2>
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={`h1-${i}`} className="text-base font-bold text-base-100 mt-3 mb-1">
          {line.slice(2)}
        </h1>
      );
      continue;
    }

    // List items
    if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-2 text-sm text-base-200 pl-2">
          <span className="text-base-400 shrink-0">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)/);
      if (match) {
        elements.push(
          <div key={`ol-${i}`} className="flex gap-2 text-sm text-base-200 pl-2">
            <span className="text-base-400 shrink-0">{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </div>
        );
        continue;
      }
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${i}`} className="text-sm text-base-200 leading-relaxed">
        {renderInline(line)}
      </p>
    );
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <CodeBlock
        key={`code-${blockIndex++}`}
        code={codeBlockContent.join("\n")}
        language={codeBlockLang}
      />
    );
  }

  return elements;
}

function renderInline(text: string): (string | ReactNode)[] {
  const parts: (string | ReactNode)[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/);

    // Find the earliest match
    let earliest: { type: string; match: RegExpMatchArray; index: number } | null = null; // eslint-disable-line

    if (boldMatch && boldMatch.index !== undefined) {
      earliest = { type: "bold", match: boldMatch, index: boldMatch.index };
    }
    if (codeMatch && codeMatch.index !== undefined) {
      if (!earliest || codeMatch.index < earliest.index) {
        earliest = { type: "code", match: codeMatch, index: codeMatch.index };
      }
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    // Add text before match
    if (earliest.index > 0) {
      parts.push(remaining.slice(0, earliest.index));
    }

    if (earliest.type === "bold") {
      parts.push(
        <strong key={`b-${keyIdx++}`} className="font-semibold text-base-100">
          {earliest.match[1]}
        </strong>
      );
    } else if (earliest.type === "code") {
      parts.push(
        <code
          key={`ic-${keyIdx++}`}
          className="px-1.5 py-0.5 rounded bg-base-800 text-accent-400 font-mono text-xs"
        >
          {earliest.match[1]}
        </code>
      );
    }

    remaining = remaining.slice(earliest.index + earliest.match[0].length);
  }

  return parts;
}

// --- Code Block Component ---

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const isSql = language.toLowerCase() === "sql" || (!language && code.match(/select|insert|update|delete|create|alter|drop/i));

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    insertTextAtCursor(code);
  };

  return (
    <div className="my-2 rounded-lg border border-base-700/50 overflow-hidden bg-base-900">
      <div className="flex items-center justify-between px-3 py-1.5 bg-base-800/50 border-b border-base-700/50">
        <span className="text-[10px] font-mono text-base-400 uppercase">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          {isSql && (
            <button
              onClick={handleInsert}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-base-400 hover:text-accent-400 hover:bg-base-700/50 transition-colors"
              title="Insert to editor"
            >
              <ArrowDownToLine className="w-3 h-3" />
              Insert
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-base-400 hover:text-base-200 hover:bg-base-700/50 transition-colors"
            title="Copy"
          >
            {copied ? (
              <Check className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
      <pre className="px-3 py-2 overflow-x-auto text-xs">
        <code className="font-mono text-base-200">{code}</code>
      </pre>
    </div>
  );
}

// --- Tool Call Display ---

function ToolCallItem({ toolCall }: { toolCall: ToolCallDisplay }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusIcon = useMemo(() => {
    switch (toolCall.status) {
      case "running":
        return <Loader2 className="w-3 h-3 text-accent-400 animate-spin" />;
      case "completed":
        return toolCall.isError ? (
          <X className="w-3 h-3 text-red-400" />
        ) : (
          <Check className="w-3 h-3 text-green-400" />
        );
      case "denied":
        return <ShieldAlert className="w-3 h-3 text-red-400" />;
      default:
        return <Loader2 className="w-3 h-3 text-base-400 animate-spin" />;
    }
  }, [toolCall.status, toolCall.isError]);

  return (
    <div className="border border-base-700/30 rounded-md overflow-hidden bg-base-850/50 my-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-base-800/30 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-base-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-base-400 shrink-0" />
        )}
        <Wrench className="w-3 h-3 text-base-400 shrink-0" />
        <span className="text-xs font-mono text-base-300 truncate">
          {toolCall.name}
        </span>
        <span className="ml-auto shrink-0">{statusIcon}</span>
      </button>

      {isExpanded && (
        <div className="px-3 py-2 border-t border-base-700/30 text-xs">
          <div className="text-base-400 mb-1">Input:</div>
          <pre className="text-base-300 font-mono overflow-x-auto mb-2 text-[11px]">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.result && (
            <>
              <div className="text-base-400 mb-1">
                {toolCall.isError ? "Error:" : "Result:"}
              </div>
              <pre
                className={cn(
                  "font-mono overflow-x-auto text-[11px] max-h-[200px] overflow-y-auto",
                  toolCall.isError ? "text-red-400" : "text-base-300"
                )}
              >
                {toolCall.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- SQL Approval Card ---

function SqlApprovalCard({ approval }: { approval: PendingApproval }) {
  const { approveToolCall } = useAiStore();

  return (
    <div className="my-3 rounded-lg border border-amber-500/30 overflow-hidden bg-amber-500/5">
      <div className="px-3 py-2 flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-amber-300">
          SQL Query Approval
        </span>
      </div>
      <div className="p-3">
        <p className="text-xs text-base-300 mb-2">
          The AI wants to run this query:
        </p>
        <pre className="px-3 py-2 rounded bg-base-900 border border-base-700/50 text-xs font-mono text-base-200 overflow-x-auto mb-3">
          {approval.sql}
        </pre>
        <div className="flex items-center gap-2">
          <button
            onClick={() => approveToolCall(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium border border-green-600/30 transition-colors"
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => approveToolCall(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600/10 hover:bg-red-600/20 text-red-400 text-xs font-medium border border-red-600/20 transition-colors"
          >
            <X className="w-3 h-3" />
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main Chat Message Component ---

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
  streamingText?: string;
  streamingToolCalls?: ToolCallDisplay[];
  pendingApproval?: PendingApproval | null;
}

export function ChatMessageComponent({
  message,
  isStreaming,
  streamingText,
  streamingToolCalls,
  pendingApproval,
}: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="px-3 py-2.5 bg-base-800/30 border-b border-base-700/20">
        <p className="text-sm text-base-100 leading-relaxed whitespace-pre-wrap">
          {message.content}
        </p>
      </div>
    );
  }

  // Assistant message
  const content = isStreaming ? streamingText || "" : message.content;
  const toolCalls = isStreaming
    ? streamingToolCalls || []
    : message.toolCalls || [];
  const isError = message.isError;

  // Error message UI
  if (isError && content) {
    return (
      <div className="px-3 py-2.5 border-b border-base-700/20">
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/8 border border-red-500/15">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-red-300 mb-0.5">Something went wrong</p>
            <p className="text-xs text-red-300/70 leading-relaxed break-words">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 border-b border-base-700/20">
      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div className="mb-2">
          {toolCalls.map((tc) => (
            <ToolCallItem key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* Pending approval */}
      {pendingApproval && <SqlApprovalCard approval={pendingApproval} />}

      {/* Message content */}
      {content && <div>{renderMarkdown(content)}</div>}

      {/* Streaming indicator */}
      {isStreaming && !content && toolCalls.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-base-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Thinking...</span>
        </div>
      )}

      {/* Streaming cursor */}
      {isStreaming && content && (
        <span className="inline-block w-1.5 h-4 bg-accent-400 animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}

