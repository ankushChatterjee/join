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
import { sanitizeExternalUrl } from "@/lib/urlSafety";
import { useAiStore } from "@/stores/aiStore";
import { useAppStore } from "@/stores/appStore";
import { insertTextAtCursor } from "@/components/editor/editorUtils";
import type { ChatMessage as ChatMessageType, ToolCallDisplay, PendingApproval, PendingQuestion, StreamingPart } from "@/ai/types";
import { addCodeInNewCell } from "./chatMessageActions";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { QuestionCard } from "./QuestionCard";

// --- Markdown Renderer ---

function MarkdownContent({
  content,
}: {
  content: string;
}) {
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
              className="rounded-sm bg-base-850 px-1.5 py-0.5 font-mono text-[13px] text-accent-300"
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
          <p className="mb-2 text-[13px] leading-[1.6] text-base-200">{children}</p>
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
        a: ({ href, children }) => {
          if (!href) {
            return <span>{children}</span>;
          }
          const safeHref = sanitizeExternalUrl(href);
          if (!safeHref) {
            return <span>{children}</span>;
          }

          // Regular external link
          return (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 text-accent-400 hover:text-accent-300"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          );
        },
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
          <blockquote className="my-2 border-l-2 border-base-700 pl-3 text-[13px] italic text-base-300">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-[12px]">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-base-700 bg-base-850 px-2 py-1 text-left font-medium text-base-200">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-base-700/70 px-2 py-1 text-base-300">{children}</td>
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
  const activeEditorTab = useAppStore((state) => state.activeEditorTab);
  const activeScriptId = useAppStore((state) => state.activeScriptId);
  const addScriptCell = useAppStore((state) => state.addScriptCell);
  const showToast = useAppStore((state) => state.showToast);
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

  const handleAddInNewCell = async () => {
    await addCodeInNewCell({
      activeScriptId,
      activeEditorTab,
      code,
      addScriptCell,
      showToast,
    });
  };

  return (
    <div className="my-2 overflow-hidden rounded-sm border border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 bg-base-850 px-2.5 py-1">
        <span className="font-mono text-[11px] uppercase text-base-300">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          {isSql && (
            <>
              <button
                onClick={handleAddInNewCell}
                className="flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] text-base-200 transition-colors-fast hover:bg-base-700 hover:text-accent-300"
                title="Add in a new cell"
              >
                <ArrowDownToLine className="w-3 h-3" />
                Add in a new cell
              </button>
              <button
                onClick={handleInsert}
                className="flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] text-base-200 transition-colors-fast hover:bg-base-700 hover:text-accent-300"
                title="Insert to editor"
              >
                <ArrowDownToLine className="w-3 h-3" />
                Insert
              </button>
            </>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] text-base-200 transition-colors-fast hover:bg-base-700 hover:text-base-100"
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
      <pre className="panel-scroll overflow-x-auto px-2.5 py-2 text-[13px]">
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
    <div className="my-2 overflow-hidden rounded-sm border border-base-700/70 bg-base-900/60">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors-fast hover:bg-base-850"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-base-300 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-base-300 shrink-0" />
        )}
        <Wrench className="w-3 h-3 text-base-300 shrink-0" />
        <span className="truncate font-mono text-[12px] text-base-200">
          {toolCall.name}
        </span>
        <span className="ml-auto shrink-0">{statusIcon}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-base-700/70 px-2.5 py-2 text-xs">
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
  
  const isAddCell = approval.toolName === "add_cell";
  const title = isAddCell ? "Add Cell Approval" : "SQL Query Approval";
  const description = isAddCell 
    ? "The agent wants to add this query to a new cell:"
    : "The AI wants to run this query:";

  return (
    <div className="my-3 overflow-hidden rounded-sm border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-1.5 border-b border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-amber-300">
          {title}
        </span>
      </div>
      <div className="p-2.5">
        <p className="mb-2 text-xs text-base-300">
          {description}
        </p>
        <pre className="panel-scroll mb-2.5 overflow-x-auto rounded-sm border border-base-700 bg-base-900 px-2.5 py-2 text-xs font-mono text-base-200">
          {approval.sql}
        </pre>
        <div className="flex items-center gap-2">
          <button
            onClick={() => approveToolCall(approval.toolCallId, true)}
            className="flex items-center gap-1.5 rounded-sm border border-green-600/30 bg-green-600/20 px-2.5 py-1 text-xs font-medium text-green-400 transition-colors-fast hover:bg-green-600/30"
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => approveToolCall(approval.toolCallId, false)}
            className="flex items-center gap-1.5 rounded-sm border border-red-600/20 bg-red-600/10 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors-fast hover:bg-red-600/20"
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
  streamingParts?: StreamingPart[];
  pendingApprovals?: PendingApproval[];
  pendingQuestions?: PendingQuestion[];
}

const ChatMessageComponentInner = ({
  message,
  isStreaming,
  streamingText,
  streamingToolCalls,
  streamingParts,
  pendingApprovals = [],
  pendingQuestions = [],
}: ChatMessageProps) => {
  if (message.role === "user") {
    return (
      <div className="py-1.5">
        <div className="px-0.5">
          <p className="whitespace-pre-wrap text-[13px] leading-6 text-base-100">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  // Assistant message
  const content = isStreaming
    ? streamingText || ""
    : message.content;
  const toolCalls = isStreaming
    ? streamingToolCalls || []
    : message.toolCalls || [];
  const parts = isStreaming
    ? streamingParts || []
    : message.parts || [];
  const isError = message.isError;

  // Error message UI
  if (isError && content) {
    return (
      <div className="py-1.5">
        <div className="flex items-start gap-2 rounded-sm border border-red-500/20 bg-red-500/8 px-2.5 py-2">
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
      <div className="rounded-sm border border-base-700/70 bg-base-900/50 px-2.5 py-2">
        {parts.length > 0 ? (
          // Inline parts - render in order
          <>
            {parts.map((part, i) => {
              if (part.type === "text") {
                // Group consecutive text parts
                if (i > 0 && parts[i - 1].type === "text") {
                  return null; // Skip, will be rendered with previous text
                }
                // Collect all consecutive text parts
                let textContent = part.text;
                let j = i + 1;
                while (j < parts.length && parts[j].type === "text") {
                  textContent += (parts[j] as { type: "text"; text: string; index: number }).text;
                  j++;
                }
                return (
                  <MarkdownContent key={`text-${part.index}`} content={textContent} />
                );
              } else {
                // Tool call - skip if it has a pending approval
                if (pendingApprovals.some((a) => a.toolCallId === part.toolCall.id)) {
                  return (
                    <SqlApprovalCard key={`approval-${part.toolCall.id}`} approval={pendingApprovals.find((a) => a.toolCallId === part.toolCall.id)!} />
                  );
                }
                return (
                  <ToolCallItem key={`tool-${part.toolCall.id}`} toolCall={part.toolCall} />
                );
              }
            })}
            {/* Streaming cursor - only when streaming */}
            {isStreaming && content && (
              <span className="inline-block w-1.5 h-4 bg-accent-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
            {/* Pending questions */}
            {pendingQuestions.map((question) => (
              <QuestionCard key={question.toolCallId} pendingQuestion={question} />
            ))}
          </>
        ) : (
          // No parts - use old layout
          <>
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

            {/* Pending questions */}
            {pendingQuestions.map((question) => (
              <QuestionCard key={question.toolCallId} pendingQuestion={question} />
            ))}

            {/* Message content */}
            {content && (
              <MarkdownContent content={content} />
            )}

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
          </>
        )}
      </div>
    </div>
  );
};

export const ChatMessageComponent = memo(ChatMessageComponentInner);
