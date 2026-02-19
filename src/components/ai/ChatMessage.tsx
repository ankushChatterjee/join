// ============================================================================
// Chat Message Component
// ============================================================================

import { memo, useState, useMemo } from "react";
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

// --- Markdown Renderer ---

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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
              className="rounded bg-base-800/80 px-1.5 py-0.5 font-mono text-[12px] text-accent-400"
              {...rest}
            >
              {children}
            </code>
          );
        },
        // Headings
        h1: ({ children }) => (
          <div className="mb-1 mt-4 text-base font-semibold text-base-100" role="heading" aria-level={1}>
            {children}
          </div>
        ),
        h2: ({ children }) => (
          <div className="mb-1 mt-3 text-sm font-semibold text-base-100" role="heading" aria-level={2}>
            {children}
          </div>
        ),
        h3: ({ children }) => (
          <div className="mb-1 mt-3 text-sm font-semibold text-base-100" role="heading" aria-level={3}>
            {children}
          </div>
        ),
        h4: ({ children }) => (
          <div className="mb-1 mt-2 text-sm font-semibold text-base-100" role="heading" aria-level={4}>
            {children}
          </div>
        ),
        h5: ({ children }) => (
          <div className="mb-0.5 mt-2 text-xs font-semibold text-base-100" role="heading" aria-level={5}>
            {children}
          </div>
        ),
        h6: ({ children }) => (
          <div className="mb-0.5 mt-2 text-xs font-semibold text-base-200" role="heading" aria-level={6}>
            {children}
          </div>
        ),
        // Paragraphs
        p: ({ children }) => (
          <p className="mb-2 text-[13px] leading-6 text-base-200">{children}</p>
        ),
        // Lists
        ul: ({ children }) => (
          <ul className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-6 text-base-200 marker:text-base-400">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 list-decimal space-y-1 pl-5 text-[13px] leading-6 text-base-200 marker:text-base-400">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="pl-0.5">{children}</li>
        ),
        // Horizontal rule
        hr: () => <hr className="my-3 border-base-700/50" />,
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 text-accent-400 hover:text-accent-300"
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
          <del className="text-base-300 line-through">{children}</del>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-base-600/70 pl-3 text-[13px] italic text-base-300">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-[12px]">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-base-700/60 bg-base-800/65 px-2 py-1 text-left font-medium text-base-200">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-base-700/50 px-2 py-1 text-base-300">{children}</td>
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
  const isSql =
    language.toLowerCase() === "sql" ||
    (!language && code.match(/select|insert|update|delete|create|alter|drop/i));

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    insertTextAtCursor(code);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-base-700/60 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700/50 bg-base-850/70 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase text-base-400">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          {isSql && (
            <button
              onClick={handleInsert}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-base-300 transition-colors hover:bg-base-700/50 hover:text-accent-300"
              title="Insert to editor"
            >
              <ArrowDownToLine className="w-3 h-3" />
              Insert
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-base-300 transition-colors hover:bg-base-700/50 hover:text-base-100"
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
      <pre className="panel-scroll overflow-x-auto px-3 py-2.5 text-xs">
        <code className="font-mono leading-relaxed text-base-200">{code}</code>
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
        return <Loader2 className="w-3 h-3 text-base-300 animate-spin" />;
    }
  }, [toolCall.status, toolCall.isError]);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-base-700/35 bg-base-850/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-base-800/30"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-base-300 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-base-300 shrink-0" />
        )}
        <Wrench className="w-3 h-3 text-base-300 shrink-0" />
        <span className="truncate font-mono text-[11px] text-base-300">
          {toolCall.name}
        </span>
        <span className="ml-auto shrink-0">{statusIcon}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-base-700/35 px-3 py-2 text-xs">
          <div className="mb-1 text-base-300">Input:</div>
          <pre className="mb-2 overflow-x-auto font-mono text-[11px] text-base-300">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.result && (
            <>
              <div className="mb-1 text-base-300">
                {toolCall.isError ? "Error:" : "Result:"}
              </div>
              <pre
                className={cn(
                  "panel-scroll max-h-[200px] overflow-x-auto overflow-y-auto font-mono text-[11px]",
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
    <div className="my-3 overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-amber-300">
          SQL Query Approval
        </span>
      </div>
      <div className="p-3">
        <p className="mb-2 text-xs text-base-300">
          The AI wants to run this query:
        </p>
        <pre className="panel-scroll mb-3 overflow-x-auto rounded border border-base-700/50 bg-base-900 px-3 py-2 text-xs font-mono text-base-200">
          {approval.sql}
        </pre>
        <div className="flex items-center gap-2">
          <button
            onClick={() => approveToolCall(approval.toolCallId, true)}
            className="flex items-center gap-1.5 rounded-md border border-green-600/30 bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-600/30"
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => approveToolCall(approval.toolCallId, false)}
            className="flex items-center gap-1.5 rounded-md border border-red-600/20 bg-red-600/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/20"
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

const ChatMessageComponentInner = ({
  message,
  isStreaming,
  streamingText,
  streamingToolCalls,
  pendingApprovals = [],
}: ChatMessageProps) => {
  if (message.role === "user") {
    return (
      <div className="py-1.5">
        <div className="px-1">
          <p className="whitespace-pre-wrap text-[13px] leading-6 text-base-100">
            {message.content}
          </p>
        </div>
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
      <div className="py-1.5">
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="mb-0.5 text-xs font-medium text-red-300">Something went wrong</p>
            <p className="break-words text-xs leading-relaxed text-red-300">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-1.5">
      <div className="rounded-xl border border-base-700/40 bg-base-900/35 px-3 py-2.5">
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
        <div className="flex items-center gap-2 py-0.5 text-xs text-base-300">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Thinking...</span>
        </div>
      )}

      {/* Streaming cursor */}
      {isStreaming && content && (
        <span className="inline-block w-1.5 h-4 bg-accent-400 animate-pulse ml-0.5 align-text-bottom" />
      )}
      </div>
    </div>
  );
};

export const ChatMessageComponent = memo(ChatMessageComponentInner);
