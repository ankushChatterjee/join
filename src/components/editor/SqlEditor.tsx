import { useCallback, useMemo, useRef, useEffect, useState, memo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL, MySQL, SQLite } from "@codemirror/lang-sql";
import { EditorView, keymap, Decoration } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Play, Loader2, Plus, Trash2, ChevronDown, ChevronRight, Search, ChevronUp, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { SqlSheetCell } from "@/stores/types";
import { getEditorView, setEditorView } from "./editorUtils";
import {
  buildHighlightRangesByCell,
  buildSearchableCells,
  findSheetMatches,
  normalizeMatchIndex,
  type SearchHighlightRange,
} from "./sqlSearch";
import { cn } from "@/lib/utils";
import { recordPerfSample } from "@/lib/perf";
import { DiffViewer } from "./DiffViewer";
import { useShallow } from "zustand/react/shallow";

const searchHitDecoration = Decoration.mark({ class: "cm-sheet-search-hit" });
const activeSearchHitDecoration = Decoration.mark({ class: "cm-sheet-search-hit-active" });

function buildSearchDecorations(ranges: SearchHighlightRange[]) {
  return Decoration.set(
    ranges.map((range) =>
      (range.isActive ? activeSearchHitDecoration : searchHitDecoration).range(range.from, range.to)
    ),
    true
  );
}

// Custom dark theme for CodeMirror - warm retro palette with high contrast
const customTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#0a0c10",
      color: "#dde3ea",
    },
    ".cm-content": {
      caretColor: "#f48734",
      fontFamily: "var(--font-mono)",
      padding: "6px 0",
      minHeight: "96px",
    },
    ".cm-cursor": {
      borderLeft: "none",
      backgroundColor: "#f48734",
      width: "0.6em",
      marginLeft: "0",
    },
    ".cm-selectionBackground": {
      backgroundColor: "rgba(244, 135, 52, 0.34) !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(244, 135, 52, 0.45) !important",
    },
    ".cm-sheet-search-hit": {
      backgroundColor: "rgba(166, 121, 79, 0.22)",
    },
    ".cm-sheet-search-hit-active": {
      backgroundColor: "rgba(244, 135, 52, 0.52) !important",
      outline: "1px solid rgba(255, 171, 113, 0.95)",
    },
    ".cm-gutters": {
      backgroundColor: "#0a0c10",
      color: "#7f8da0",
      border: "none",
      borderRight: "1px solid rgba(42, 49, 62, 0.75)",
      paddingRight: "4px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      paddingLeft: "8px",
      minWidth: "32px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#10141b",
      color: "#a8b2bf",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(42, 42, 42, 0.24)",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(244, 135, 52, 0.2)",
      color: "#ffab71 !important",
      outline: "1px solid #d76b1e",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#10141b",
      border: "none",
      color: "#7f8da0",
    },
  },
  { dark: true }
);

const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#f4f6f8", fontWeight: "600" },
  { tag: tags.string, color: "#8dc8a5" },
  { tag: tags.number, color: "#f0a365" },
  { tag: tags.comment, color: "#7f8da0", fontStyle: "italic" },
  { tag: tags.operator, color: "#c5ccd5" },
  { tag: tags.punctuation, color: "#a8b2bf" },
  { tag: tags.typeName, color: "#ffab71" },
  { tag: tags.standard(tags.name), color: "#d9c2ae" },
  { tag: tags.function(tags.name), color: "#d9c2ae" },
  { tag: tags.variableName, color: "#cfd5dd" },
  { tag: tags.propertyName, color: "#cfd5dd" },
  { tag: tags.definition(tags.name), color: "#cfd5dd" },
  { tag: tags.special(tags.variableName), color: "#ffab71" },
]);

function formatRunMeta(cell: SqlSheetCell): { when: string; duration: string; status: string } {
  if (!cell.last_run_at) {
    return {
      when: "NEVER",
      duration: "--",
      status: "IDLE",
    };
  }

  const lastRun = new Date(cell.last_run_at);
  const now = new Date();
  const isSameDay =
    lastRun.getFullYear() === now.getFullYear() &&
    lastRun.getMonth() === now.getMonth() &&
    lastRun.getDate() === now.getDate();

  const when = isSameDay
    ? lastRun.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : lastRun.toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

  return {
    when,
    duration: cell.last_run_duration_ms != null ? `${cell.last_run_duration_ms}ms` : "--",
    status: cell.last_run_successful ? "OK" : "FAIL",
  };
}

interface SqlCellProps {
  scriptId: string;
  cell: SqlSheetCell;
  index: number;
  isSelected: boolean;
  isRunning: boolean;
  canRemove: boolean;
  isCollapsed: boolean;
  sqlExtension: ReturnType<typeof sql>;
  onSelect: () => void;
  onChange: (value: string) => void;
  onRun: () => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  suppressAutoFocus?: boolean;
  searchHighlightRanges?: SearchHighlightRange[];
}

function SqlCell({
  scriptId,
  cell,
  index,
  isSelected,
  isRunning,
  canRemove,
  isCollapsed,
  sqlExtension,
  onSelect,
  onChange,
  onRun,
  onRemove,
  onToggleCollapse,
  suppressAutoFocus = false,
  searchHighlightRanges = [],
}: SqlCellProps) {
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (isSelected && viewRef.current) {
      // Keep global editor reference in sync with the selected cell even when
      // search mode suppresses editor focus.
      setEditorView(viewRef.current, cell.id);
      if (!suppressAutoFocus) {
        viewRef.current.focus();
      }
    }
  }, [isSelected, cell.id, suppressAutoFocus]);

  const runQueryKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRun();
              return true;
            },
          },
        ])
      ),
    [onRun]
  );
  const searchHighlightExtension = useMemo(
    () => EditorView.decorations.of(buildSearchDecorations(searchHighlightRanges)),
    [searchHighlightRanges]
  );

  const preview = useMemo(() => {
    const singleLine = cell.sql.replace(/\s+/g, " ").trim();
    if (!singleLine) return "Empty cell";
    return singleLine.length > 140 ? `${singleLine.slice(0, 140)}...` : singleLine;
  }, [cell.sql]);

  const runMeta = useMemo(() => formatRunMeta(cell), [cell]);
  const statusDotClass =
    runMeta.status === "OK"
      ? "bg-green-400"
      : runMeta.status === "FAIL"
        ? "bg-red-400"
        : "bg-base-500";

  return (
    <div
      id={`cell-${cell.id}`}
      onMouseDown={onSelect}
      className={cn(
        "overflow-hidden border-b transition-colors-fast",
        isSelected ? "border-base-700 bg-base-900/95" : "border-base-800/80 bg-base-900/55"
      )}
      data-script-id={scriptId}
      data-cell-id={cell.id}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 border-b px-2 py-1",
          isSelected ? "border-base-700/90 bg-base-850/60" : "border-base-800/80 bg-base-900/45"
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          tabIndex={-1}
          className="w-[20px] h-[20px] flex items-center justify-center rounded-sm text-base-300 hover:text-base-100 hover:bg-base-800/90 transition-colors-fast"
          title={isCollapsed ? "Expand cell" : "Collapse cell"}
        >
          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        <div
          className={cn(
            "flex h-[20px] items-center justify-center px-1.5 text-[11px] font-medium",
            isSelected ? "bg-base-800/75 text-base-100" : "bg-base-900/55 text-base-300"
          )}
        >
          {index + 1}
        </div>

        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-base-300">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDotClass)} />
          <span className="truncate">Last run {runMeta.when}</span>
          <span className="shrink-0">{runMeta.duration}</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onRun}
            disabled={isRunning}
            className="flex h-[20px] items-center justify-center gap-1 px-1.5 text-[11px] font-semibold text-accent-300 transition-colors-fast hover:bg-accent-500/8 disabled:cursor-not-allowed disabled:opacity-50"
            title="Run cell (⌘+Enter)"
          >
            {isRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" fill="currentColor" />
            )}
          </button>
          <button
            onClick={onRemove}
            disabled={!canRemove}
            className="flex h-[20px] items-center justify-center gap-1 px-1.5 text-[11px] font-semibold text-base-300 transition-colors-fast hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
            title={canRemove ? "Remove cell" : "Cannot remove the only cell"}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {cell.proposed_sql ? (
        <div className="border-t border-base-800 bg-base-900 p-1.5">
          <DiffViewer
            oldValue={cell.sql}
            newValue={cell.proposed_sql}
            onAccept={() => useAppStore.getState().acceptScriptCellProposal(scriptId, cell.id)}
            onReject={() => useAppStore.getState().rejectScriptCellProposal(scriptId, cell.id)}
          />
        </div>
      ) : isCollapsed ? (
        <div className="border-t border-base-800/90 bg-base-900/55 px-2.5 py-1.5 font-mono text-[12px] text-base-200">
          <span className="text-base-400 mr-2">PREVIEW</span>
          {preview}
        </div>
      ) : (
        <CodeMirror
          value={cell.sql}
          onChange={onChange}
          onBlur={() => {
            void useAppStore.getState().flushScriptNow(scriptId);
          }}
          onCreateEditor={(view) => {
            viewRef.current = view;
            if (isSelected) {
              setEditorView(view, cell.id);
            }
          }}
          onFocus={onSelect}
          extensions={[
            sqlExtension,
            EditorView.lineWrapping,
            syntaxHighlighting(sqlHighlightStyle),
            runQueryKeymap,
            searchHighlightExtension,
          ]}
          theme={customTheme}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            rectangularSelection: true,
            crosshairCursor: false,
            highlightSelectionMatches: false,
            closeBracketsKeymap: true,
            searchKeymap: true,
            foldKeymap: true,
            completionKeymap: false,
            lintKeymap: true,
          }}
          className="text-[14px] border-t border-base-800/90"
        />
      )}
    </div>
  );
}

function areSearchRangesEqual(a: SearchHighlightRange[], b: SearchHighlightRange[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].from !== b[i].from || a[i].to !== b[i].to || a[i].isActive !== b[i].isActive) {
      return false;
    }
  }
  return true;
}

const MemoizedSqlCell = memo(SqlCell, (prev, next) => (
  prev.cell === next.cell &&
  prev.index === next.index &&
  prev.isSelected === next.isSelected &&
  prev.isRunning === next.isRunning &&
  prev.canRemove === next.canRemove &&
  prev.isCollapsed === next.isCollapsed &&
  prev.sqlExtension === next.sqlExtension &&
  prev.suppressAutoFocus === next.suppressAutoFocus &&
  areSearchRangesEqual(prev.searchHighlightRanges ?? [], next.searchHighlightRanges ?? [])
));

export function SqlEditor() {
  const {
    connections,
    openScripts,
    activeScriptId,
    updateScriptContent,
    setSelectedScriptCell,
    addScriptCell,
    removeScriptCell,
    executeScriptCell,
    executingCell,
  } = useAppStore(
    useShallow((state) => ({
      connections: state.connections,
      openScripts: state.openScripts,
      activeScriptId: state.activeScriptId,
      updateScriptContent: state.updateScriptContent,
      setSelectedScriptCell: state.setSelectedScriptCell,
      addScriptCell: state.addScriptCell,
      removeScriptCell: state.removeScriptCell,
      executeScriptCell: state.executeScriptCell,
      executingCell: state.executingCell,
    }))
  );
  const [collapsedCells, setCollapsedCells] = useState<Record<string, boolean>>({});
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [pendingMatch, setPendingMatch] = useState<{ cellId: string; from: number; to: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const activeScript = useMemo(
    () => openScripts.find((s) => s.id === activeScriptId),
    [openScripts, activeScriptId]
  );

  const activeConnection = connections.find((c) => c.id === activeScript?.connectionId);
  const dialect =
    activeConnection?.db_type === "mysql"
      ? MySQL
      : activeConnection?.db_type === "sqlite"
        ? SQLite
        : PostgreSQL;

  const sqlExtension = useMemo(
    () => sql({ dialect, upperCaseKeywords: true }),
    [dialect]
  );
  const searchableCells = useMemo(
    () => buildSearchableCells(activeScript?.cells, isSearchOpen),
    [activeScript?.cells, isSearchOpen]
  );
  const searchMatches = useMemo(() => findSheetMatches(searchableCells, searchQuery, 5000), [searchableCells, searchQuery]);
  const searchHighlightRangesByCell = useMemo(
    () => buildHighlightRangesByCell(searchMatches, activeMatchIndex),
    [searchMatches, activeMatchIndex]
  );
  useEffect(() => {
    if (!activeScript) {
      setEditorView(null, null);
    }
  }, [activeScript]);

  useEffect(() => {
    if (!isSearchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isSearchOpen]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }
    setActiveMatchIndex((prev) => {
      if (prev < 0) return -1;
      return Math.min(prev, searchMatches.length - 1);
    });
  }, [searchMatches]);

  useEffect(() => {
    setActiveMatchIndex(-1);
  }, [searchQuery]);

  useEffect(() => {
    if (!pendingMatch || !activeScript) return;
    if (activeScript.selectedCellId !== pendingMatch.cellId) return;

    const view = getEditorView();
    if (!view) return;

    const maxLen = view.state.doc.length;
    const from = Math.min(Math.max(pendingMatch.from, 0), maxLen);
    const to = Math.min(Math.max(pendingMatch.to, from), maxLen);
    view.dispatch({
      selection: { anchor: from, head: to },
      scrollIntoView: true,
    });
    searchInputRef.current?.focus();
    setPendingMatch(null);
  }, [activeScript, pendingMatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      if (event.key === "Escape" && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isSearchOpen]);

  const handleAddCell = useCallback(async () => {
    if (!activeScriptId) return;
    await addScriptCell(activeScriptId, "", true);
  }, [activeScriptId, addScriptCell]);

  const jumpToMatch = useCallback(
    (targetIndex: number) => {
      if (!activeScript || searchMatches.length === 0) return;
      const normalizedIndex = normalizeMatchIndex(targetIndex, searchMatches.length);
      if (normalizedIndex < 0) return;
      const match = searchMatches[normalizedIndex];

      setActiveMatchIndex(normalizedIndex);
      setCollapsedCells((prev) => {
        if (!prev[match.cellId]) return prev;
        return { ...prev, [match.cellId]: false };
      });

      if (activeScript.selectedCellId !== match.cellId) {
        setSelectedScriptCell(activeScript.id, match.cellId);
      }
      setPendingMatch({ cellId: match.cellId, from: match.from, to: match.to });
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    },
    [activeScript, searchMatches, setSelectedScriptCell]
  );

  const toggleCellCollapse = useCallback((cellId: string) => {
    setCollapsedCells((prev) => ({
      ...prev,
      [cellId]: !prev[cellId],
    }));
  }, []);

  if (!activeScript || !activeScriptId) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-base-300">
        Open a SQL sheet to start
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {isSearchOpen && (
        <div className="pointer-events-none absolute top-2 right-2 z-20 w-full max-w-[380px]">
          <div className="pointer-events-auto border border-base-700 bg-base-900/98 backdrop-blur-sm px-1.5 py-1 flex items-center gap-1.5 shadow-[0_0_0_1px_rgba(166,121,79,0.16)]">
            <Search className="w-3.5 h-3.5 text-accent-300 shrink-0" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  jumpToMatch((activeMatchIndex < 0 ? -1 : activeMatchIndex) + (e.shiftKey ? -1 : 1));
                }
              }}
              placeholder="Find in SQL sheet"
              className="min-w-0 flex-1 h-6 bg-base-850 border border-base-700 px-2 text-[12px] text-base-100 outline-none focus:border-accent-500/45"
            />
            <span className="text-[11px] text-base-300 tabular-nums min-w-[70px] text-right">
              {searchMatches.length === 0 ? "0 / 0" : `${activeMatchIndex < 0 ? 0 : activeMatchIndex + 1} / ${searchMatches.length}`}
            </span>
            <button
              onClick={() =>
                jumpToMatch(activeMatchIndex < 0 ? searchMatches.length - 1 : activeMatchIndex - 1)
              }
              disabled={searchMatches.length === 0}
              className="w-6 h-6 flex items-center justify-center text-base-200 hover:text-base-50 hover:bg-base-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors-fast"
              title="Previous match (Shift+Enter)"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => jumpToMatch(activeMatchIndex < 0 ? 0 : activeMatchIndex + 1)}
              disabled={searchMatches.length === 0}
              className="w-6 h-6 flex items-center justify-center text-base-200 hover:text-base-50 hover:bg-base-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors-fast"
              title="Next match (Enter)"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsSearchOpen(false)}
              className="w-6 h-6 flex items-center justify-center text-base-300 hover:text-base-100 hover:bg-base-800 transition-colors-fast"
              title="Close search (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="h-full w-full p-1.5 space-y-1.5 panel-scroll scrollbar-stable">
        {activeScript.cells.map((cell, index) => {
          const isSelected = activeScript.selectedCellId === cell.id;
          const isRunning =
            executingCell?.scriptId === activeScript.id && executingCell?.cellId === cell.id;

          return (
            <MemoizedSqlCell
              key={cell.id}
              scriptId={activeScript.id}
              cell={cell}
              index={index}
              isSelected={isSelected}
              isRunning={isRunning}
              canRemove={activeScript.cells.length > 1}
              isCollapsed={Boolean(collapsedCells[cell.id])}
              sqlExtension={sqlExtension}
              onSelect={() => {
                setSelectedScriptCell(activeScript.id, cell.id);
              }}
              onChange={(value) => {
                const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
                if (activeScript.selectedCellId !== cell.id) {
                  setSelectedScriptCell(activeScript.id, cell.id);
                }
                updateScriptContent(activeScript.id, value);
                requestAnimationFrame(() => {
                  const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
                  recordPerfSample("editor.keypress_to_paint_ms", endedAt - startedAt);
                });
              }}
              onRun={() => executeScriptCell(activeScript.id, cell.id)}
              onRemove={() => removeScriptCell(activeScript.id, cell.id)}
              onToggleCollapse={() => toggleCellCollapse(cell.id)}
              suppressAutoFocus={isSearchOpen}
              searchHighlightRanges={searchHighlightRangesByCell[cell.id] ?? []}
            />
          );
        })}

        <button
          onClick={handleAddCell}
          className="group mx-auto flex w-fit h-6 px-2 rounded-sm border border-base-700/80 bg-base-900/75 hover:bg-base-850 text-base-200 transition-colors-fast items-center justify-center gap-1"
        >
          <Plus className="w-3 h-3 text-accent-300 group-hover:text-accent-200" />
          <span className="text-[11px] font-medium tracking-[0.02em]">Add cell</span>
        </button>
      </div>
    </div>
  );
}
