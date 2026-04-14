import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  Database,
  FileCode2,
  Folder,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { CodebaseConnection, ExtractedCodebaseQuery } from "@/stores/types";

interface CodebaseProgressPayload {
  codebaseId: string;
  phase: string;
  text: string;
  append: boolean;
}

interface CodebaseStreamState {
  phase: string;
  text: string;
  isStreaming: boolean;
}

function formatIndexedAt(timestamp?: number | null): string {
  if (!timestamp) return "Queries not pulled yet";
  return `Pulled ${new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function sourceLabel(query: ExtractedCodebaseQuery): string {
  const line = query.startLine ? `:${query.startLine}` : "";
  return `${query.sourcePath}${line}`;
}

interface QueryRowProps {
  query: ExtractedCodebaseQuery;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  disabled: boolean;
}

function QueryRow({ query, selected, onToggle, onOpen, disabled }: QueryRowProps) {
  return (
    <div className="mx-3 border-t border-base-800/70 px-2 py-1.5">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 h-3 w-3 accent-[var(--color-accent-500)]"
          aria-label={`Select ${query.name}`}
        />
        <button
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
          title={query.notes || sourceLabel(query)}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <FileCode2 className="h-3 w-3 shrink-0 text-base-300" />
            <span className="truncate text-[12px] font-semibold text-base-100">
              {query.name}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-base-300">
            {sourceLabel(query)}
          </div>
          {query.notes ? (
            <div className="mt-0.5 line-clamp-2 text-[11px] text-base-300">
              {query.notes}
            </div>
          ) : null}
        </button>
        <button
          onClick={onOpen}
          disabled={disabled}
          className="shrink-0 px-1.5 py-1 text-[11px] font-semibold text-accent-300 transition-colors-fast hover:bg-accent-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          title="Open query in a SQL sheet"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function StreamBox({ stream }: { stream?: CodebaseStreamState }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [stream?.text, stream?.phase]);

  useEffect(() => {
    if (!stream || (!stream.text.trim() && !stream.isStreaming)) {
      setIsVisible(false);
      setIsRendered(false);
      return;
    }

    setIsRendered(true);
    const fadeIn = requestAnimationFrame(() => setIsVisible(true));
    let fadeOutTimer: ReturnType<typeof setTimeout> | undefined;
    let unmountTimer: ReturnType<typeof setTimeout> | undefined;

    if (!stream.isStreaming) {
      fadeOutTimer = setTimeout(() => setIsVisible(false), 900);
      unmountTimer = setTimeout(() => setIsRendered(false), 1450);
    }

    return () => {
      cancelAnimationFrame(fadeIn);
      if (fadeOutTimer) clearTimeout(fadeOutTimer);
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, [stream]);

  if (!isRendered || !stream || (!stream.text.trim() && !stream.isStreaming)) {
    return null;
  }

  return (
    <div
      className={cn(
        "mx-3 mb-2 rounded-md border border-base-800/80 bg-base-950/70 px-2 py-2 transition-all duration-500",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      )}
    >
      <div
        ref={scrollerRef}
        className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-base-100/45"
      >
        {stream.text.trim() || "Working..."}
      </div>
    </div>
  );
}

function CodebaseTile({
  codebase,
  stream,
}: {
  codebase: CodebaseConnection;
  stream?: CodebaseStreamState;
}) {
  const {
    connections,
    activeConnectionId,
    isLoadingCodebases,
    toggleCodebaseExpanded,
    fetchAllCodebaseQueries,
    disconnectCodebase,
    openCodebaseQueriesAsSheet,
  } = useAppStore(
    useShallow((state) => ({
      connections: state.connections,
      activeConnectionId: state.activeConnectionId,
      isLoadingCodebases: state.isLoadingCodebases,
      toggleCodebaseExpanded: state.toggleCodebaseExpanded,
      fetchAllCodebaseQueries: state.fetchAllCodebaseQueries,
      disconnectCodebase: state.disconnectCodebase,
      openCodebaseQueriesAsSheet: state.openCodebaseQueriesAsSheet,
    }))
  );
  const defaultConnectionId = activeConnectionId ?? connections[0]?.id ?? "";
  const [connectionId, setConnectionId] = useState(defaultConnectionId);
  const [selectedQueryIds, setSelectedQueryIds] = useState<Set<string>>(() => new Set());

  const selectedIds = useMemo(() => Array.from(selectedQueryIds), [selectedQueryIds]);
  const effectiveConnectionId = connectionId || defaultConnectionId;
  const canOpen = Boolean(effectiveConnectionId) && !isLoadingCodebases;

  const openQueries = async (queryIds: string[]) => {
    if (!canOpen || queryIds.length === 0) return;
    await openCodebaseQueriesAsSheet(codebase.id, queryIds, effectiveConnectionId);
  };

  const toggleQuery = (queryId: string) => {
    setSelectedQueryIds((prev) => {
      const next = new Set(prev);
      if (next.has(queryId)) next.delete(queryId);
      else next.add(queryId);
      return next;
    });
  };

  return (
    <div className="border-b border-base-750/60 bg-base-900/70">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={() => toggleCodebaseExpanded(codebase.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-left transition-colors-fast hover:bg-base-850/60"
          title={codebase.isExpanded ? "Collapse codebase" : "Expand codebase"}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-base-300 transition-transform duration-150",
              codebase.isExpanded && "rotate-90"
            )}
          />
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent-300" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-base-100">
            Codebase
          </span>
          <span className="text-[12px] text-base-200">[{codebase.queries.length}]</span>
        </button>
        <button
          onClick={() => fetchAllCodebaseQueries(codebase.id)}
          disabled={isLoadingCodebases}
          className="ghost-button -mr-1 rounded-sm p-1 transition-colors-fast disabled:opacity-40"
          title="Pull all queries"
        >
          {isLoadingCodebases ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={() => disconnectCodebase(codebase.id)}
          disabled={isLoadingCodebases}
          className="ghost-button -mr-1 rounded-sm p-1 text-base-300 transition-colors-fast hover:text-red-300 disabled:opacity-40"
          title="Disconnect folder"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {codebase.isExpanded ? (
        <div className="pb-3">
          <div className="mx-3 px-2 pb-2">
            <div className="truncate text-[12px] font-semibold text-base-100">{codebase.name}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-base-300">{codebase.rootPath}</div>
            <div className="mt-1 text-[11px] text-base-300">
              {isLoadingCodebases ? "Pulling queries..." : formatIndexedAt(codebase.lastIndexedAt)}
            </div>
            {codebase.lastError ? (
              <div className="mt-1 rounded-sm border border-red-500/30 bg-red-500/8 px-2 py-1 text-[11px] text-red-200">
                {codebase.lastError}
              </div>
            ) : null}
            <div className="mt-2">
              <button
                onClick={() => fetchAllCodebaseQueries(codebase.id)}
                disabled={isLoadingCodebases}
                className="rounded-sm border border-base-700 px-2 py-1 text-[11px] font-semibold text-base-100 transition-colors-fast hover:bg-base-850 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {codebase.lastIndexedAt ? "Pull all queries again" : "Pull all queries"}
              </button>
            </div>
          </div>

          <StreamBox stream={stream} />

          {codebase.queries.length > 0 && connections.length > 0 ? (
            <div className="mx-3 mb-2 flex items-center gap-1.5 px-2">
              <Database className="h-3 w-3 shrink-0 text-base-300" />
              <select
                value={effectiveConnectionId}
                onChange={(event) => setConnectionId(event.target.value)}
                className="min-w-0 flex-1 border border-base-700 bg-base-850 px-1.5 py-1 text-[11px] text-base-100 outline-none focus:border-accent-500/60"
                aria-label="Database connection for extracted queries"
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </div>
          ) : codebase.queries.length > 0 ? (
            <div className="mx-3 mb-2 px-2 text-[11px] text-base-300">
              Add a database connection before opening extracted queries.
            </div>
          ) : null}

          {selectedIds.length > 0 ? (
            <div className="mx-3 mb-2 flex items-center justify-between px-2">
              <span className="text-[11px] text-base-300">{selectedIds.length} selected</span>
              <button
                onClick={() => openQueries(selectedIds)}
                disabled={!canOpen}
                className="px-2 py-1 text-[11px] font-semibold text-accent-300 transition-colors-fast hover:bg-accent-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Open selected
              </button>
            </div>
          ) : null}

          {codebase.queries.length === 0 ? (
            <div className="mx-3 px-2 py-2 text-[12px] text-base-300">
              {isLoadingCodebases
                ? "Looking for SQL queries..."
                : "Queries stay unloaded until you pull them here or ask the agent for one in chat."}
            </div>
          ) : (
            <div className="max-h-[34vh] overflow-y-auto">
              {codebase.queries.map((query) => (
                <QueryRow
                  key={query.id}
                  query={query}
                  selected={selectedQueryIds.has(query.id)}
                  onToggle={() => toggleQuery(query.id)}
                  onOpen={() => openQueries([query.id])}
                  disabled={!canOpen}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CodebaseList() {
  const [streams, setStreams] = useState<Record<string, CodebaseStreamState>>({});
  const { codebases, isLoadingCodebases, connectCodebase } = useAppStore(
    useShallow((state) => ({
      codebases: state.codebases,
      isLoadingCodebases: state.isLoadingCodebases,
      connectCodebase: state.connectCodebase,
    }))
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<CodebaseProgressPayload>("codebase-progress", (event) => {
      const payload = event.payload;
      setStreams((prev) => {
        const existing = prev[payload.codebaseId];
        const nextText = payload.append
          ? `${existing?.text ?? ""}${existing?.text ? "\n" : ""}${payload.text}`.slice(-2400)
          : payload.text.slice(-2400);
        return {
          ...prev,
          [payload.codebaseId]: {
            phase: payload.phase,
            text: nextText,
            isStreaming: !["completed", "error"].includes(payload.phase),
          },
        };
      });
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleConnect = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Connect a local folder",
    });
    if (!selected || typeof selected !== "string") return;
    await connectCodebase(selected);
  };

  if (codebases.length > 0) {
    return <CodebaseTile codebase={codebases[0]} stream={streams[codebases[0].id]} />;
  }

  return (
    <div className="border-b border-base-750/60 bg-base-900/70">
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-left">
          <ChevronRight className="h-3 w-3 shrink-0 text-base-500" />
          <Folder className="h-3.5 w-3.5 shrink-0 text-base-300" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-base-100">
            Codebase
          </span>
        </div>
        <button
          onClick={handleConnect}
          disabled={isLoadingCodebases}
          className="ghost-button -mr-1 rounded-sm p-1 transition-colors-fast disabled:opacity-40"
          aria-label="Connect folder"
          title="Connect folder"
        >
          {isLoadingCodebases ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="px-5 pb-3 text-[12px] text-base-300">
        {isLoadingCodebases ? "Indexing folder..." : "Connect any local folder to extract SQL queries."}
      </div>
    </div>
  );
}
