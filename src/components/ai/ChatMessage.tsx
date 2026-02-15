// ============================================================================
// Chat Message Component
// ============================================================================

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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

// --- Markdown Renderer ---

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        // Code blocks
        code(props) {
          const { node, className, children, ...rest } = props as any;
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "";
          const codeString = String(children).replace(/\n$/, "");

          // If there's no className, it's likely inline code
          const isInline = !className || !className.includes("language-");

          return !isInline ? (
            <CodeBlock code={codeString} language={language} />
          ) : (
            <code
              className="px-1.5 py-0.5 rounded bg-base-800 text-accent-400 font-mono text-xs"
              {...rest}
            >
              {children}
            </code>
          );
        },
        // Headings
        h1: ({ children }) => (
          <div className="text-base font-bold text-base-100 mt-3 mb-1" role="heading" aria-level={1}>
            {children}
          </div>
        ),
        h2: ({ children }) => (
          <div className="text-sm font-semibold text-base-100 mt-3 mb-1" role="heading" aria-level={2}>
            {children}
          </div>
        ),
        h3: ({ children }) => (
          <div className="text-sm font-semibold text-base-100 mt-3 mb-1" role="heading" aria-level={3}>
            {children}
          </div>
        ),
        h4: ({ children }) => (
          <div className="text-sm font-semibold text-base-100 mt-2 mb-1" role="heading" aria-level={4}>
            {children}
          </div>
        ),
        h5: ({ children }) => (
          <div className="text-xs font-semibold text-base-100 mt-2 mb-0.5" role="heading" aria-level={5}>
            {children}
          </div>
        ),
        h6: ({ children }) => (
          <div className="text-xs font-semibold text-base-200 mt-2 mb-0.5" role="heading" aria-level={6}>
            {children}
          </div>
        ),
        // Paragraphs
        p: ({ children }) => (
          <p className="text-sm text-base-200 leading-relaxed mb-2">{children}</p>
        ),
        // Lists
        ul: ({ children }) => (
          <ul className="list-none space-y-1 my-2">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-none space-y-1 my-2">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="flex gap-2 text-sm text-base-200 pl-2 list-none">
            <span className="text-base-400 shrink-0">•</span>
            <span>{children}</span>
          </li>
        ),
        // Horizontal rule
        hr: () => <hr className="border-base-700/50 my-2" />,
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:text-accent-300 underline underline-offset-2"
          >
            {children}
          </a>
        ),
        // Strong/Bold
        strong: ({ children }) => (
          <strong className="font-semibold text-base-100">{children}</strong>
        ),
        // Emphasis/Italic
        em: ({ children }) => (
          <em className="italic text-base-200">{children}</em>
        ),
        // Strikethrough
        del: ({ children }) => (
          <del className="text-base-400 line-through">{children}</del>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
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
            onClick={() => approveToolCall(approval.toolCallId, true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium border border-green-600/30 transition-colors"
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => approveToolCall(approval.toolCallId, false)}
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
  pendingApprovals?: PendingApproval[];
}

export function ChatMessageComponent({
  message,
  isStreaming,
  streamingText,
  streamingToolCalls,
  pendingApprovals = [],
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
      {/* Tool calls (skip any that have a pending approval — the approval cards handle those) */}
      {toolCalls.length > 0 && (
        <div className="mb-2">
          {toolCalls
            .filter((tc) => !pendingApprovals.some((a) => a.toolCallId === tc.id))
            .map((tc) => (
              <ToolCallItem key={tc.id} toolCall={tc} />
            ))}
        </div>
      )}

      {/* Pending approvals */}
      {pendingApprovals.map((approval) => (
        <SqlApprovalCard key={approval.toolCallId} approval={approval} />
      ))}

      {/* Message content */}
      {content && <MarkdownContent content={content} />}

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

