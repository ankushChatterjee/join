import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL, MySQL, SQLite } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Play, Loader2, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { SqlSheetCell } from "@/stores/types";
import { setEditorView } from "./editorUtils";
import { buildCompletionSchema } from "./completionSchema";
import { cn } from "@/lib/utils";

// Custom dark theme for CodeMirror - warm retro palette with high contrast
const customTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#14110f",
      color: "#e8e4db",
    },
    ".cm-content": {
      caretColor: "#d4b896",
      fontFamily: "var(--font-mono)",
      padding: "10px 0",
      minHeight: "110px",
    },
    ".cm-cursor": {
      borderLeft: "none",
      backgroundColor: "#d4b896",
      width: "0.6em",
      marginLeft: "0",
    },
    ".cm-selectionBackground": {
      backgroundColor: "rgba(184, 149, 108, 0.15) !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(184, 149, 108, 0.2) !important",
    },
    ".cm-gutters": {
      backgroundColor: "#0f0d0b",
      color: "#8f816f",
      border: "none",
      borderRight: "1px solid #2b251f",
      paddingRight: "6px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      paddingLeft: "10px",
      minWidth: "32px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#1b1714",
      color: "#a09382",
    },
    ".cm-activeLine": {
      backgroundColor: "#1b1714",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(184, 149, 108, 0.2)",
      color: "#d4b896 !important",
      outline: "1px solid #b8956c",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#221d19",
      border: "none",
      color: "#8f816f",
    },
  },
  { dark: true }
);

const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#f0ebe0", fontWeight: "600" },
  { tag: tags.string, color: "#a3d9a5" },
  { tag: tags.number, color: "#e8a870" },
  { tag: tags.comment, color: "#9a8f7d", fontStyle: "italic" },
  { tag: tags.operator, color: "#d4c8b0" },
  { tag: tags.punctuation, color: "#c4b8a5" },
  { tag: tags.typeName, color: "#d4b896" },
  { tag: tags.standard(tags.name), color: "#e0b8a0" },
  { tag: tags.function(tags.name), color: "#e0b8a0" },
  { tag: tags.variableName, color: "#d8cbb8" },
  { tag: tags.propertyName, color: "#d8cbb8" },
  { tag: tags.definition(tags.name), color: "#d8cbb8" },
  { tag: tags.special(tags.variableName), color: "#d4b896" },
]);

function formatRunInfo(cell: SqlSheetCell): string {
  if (!cell.last_run_at) {
    return "Never run";
  }

  const when = new Date(cell.last_run_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const duration = cell.last_run_duration_ms != null ? `${cell.last_run_duration_ms} ms` : "n/a";
  const status = cell.last_run_successful ? "success" : "failed";
  return `${when} · ${duration} · ${status}`;
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
}: SqlCellProps) {
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (isSelected && viewRef.current) {
      setEditorView(viewRef.current, cell.id);
    }
  }, [isSelected, cell.id]);

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

  const preview = useMemo(() => {
    const singleLine = cell.sql.replace(/\s+/g, " ").trim();
    if (!singleLine) return "Empty cell";
    return singleLine.length > 140 ? `${singleLine.slice(0, 140)}...` : singleLine;
  }, [cell.sql]);

  return (
    <div
      onMouseDown={onSelect}
      className={cn(
        "rounded-md border transition-colors overflow-hidden",
        isSelected ? "border-accent-500/70 bg-base-900/80 shadow-[0_0_0_1px_rgba(217,184,140,0.15)]" : "border-base-700 bg-base-900/40"
      )}
      data-script-id={scriptId}
      data-cell-id={cell.id}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 border-b",
          isSelected ? "border-base-700 bg-base-850/90" : "border-base-800 bg-base-900/60"
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-5 h-5 flex items-center justify-center rounded text-base-200 hover:bg-base-700/70 transition-colors"
          title={isCollapsed ? "Expand cell" : "Collapse cell"}
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <div
          className={cn(
            "min-w-[24px] h-5 px-1.5 rounded-md text-[11px] font-semibold font-mono flex items-center justify-center",
            isSelected ? "bg-accent-500/30 text-accent-100 border border-accent-400/40" : "bg-base-700/80 text-base-100 border border-base-600"
          )}
        >
          {index + 1}
        </div>

        <span className="text-[12px] text-base-200 truncate">{formatRunInfo(cell)}</span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onRun}
            disabled={isRunning}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-accent-500/30 text-accent-100 hover:bg-accent-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Run cell (⌘+Enter)"
          >
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" fill="currentColor" />
            )}
          </button>
          <button
            onClick={onRemove}
            disabled={!canRemove}
            className="w-6 h-6 flex items-center justify-center rounded text-base-200 hover:text-red-300 hover:bg-red-500/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={canRemove ? "Remove cell" : "Cannot remove the only cell"}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isCollapsed ? (
        <div className="px-3 py-2 text-xs text-base-200 font-mono bg-base-900/40">{preview}</div>
      ) : (
        <CodeMirror
          value={cell.sql}
          onChange={onChange}
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
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: false,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            searchKeymap: true,
            foldKeymap: true,
            completionKeymap: true,
            lintKeymap: true,
          }}
          className="text-sm"
        />
      )}
    </div>
  );
}

export function SqlEditor() {
  const {
    connections,
    openScripts,
    activeScriptId,
    updateScriptContent,
    tablesBySchema,
    viewsBySchema,
    columns,
    setSelectedScriptCell,
    addScriptCell,
    removeScriptCell,
    executeScriptCell,
    executingCell,
  } = useAppStore();
  const [collapsedCells, setCollapsedCells] = useState<Record<string, boolean>>({});

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

  const completionSchema = useMemo(
    () => buildCompletionSchema(tablesBySchema, viewsBySchema, columns),
    [tablesBySchema, viewsBySchema, columns]
  );

  const sqlExtension = useMemo(
    () => sql({ dialect, schema: completionSchema, upperCaseKeywords: true }),
    [dialect, completionSchema]
  );

  useEffect(() => {
    if (!activeScript) {
      setEditorView(null, null);
    }
  }, [activeScript]);

  const handleAddCell = useCallback(async () => {
    if (!activeScriptId) return;
    await addScriptCell(activeScriptId, "", true);
  }, [activeScriptId, addScriptCell]);

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
    <div className="h-full w-full overflow-auto p-1.5 space-y-2 panel-scroll scrollbar-stable">
      {activeScript.cells.map((cell, index) => {
        const isSelected = activeScript.selectedCellId === cell.id;
        const isRunning =
          executingCell?.scriptId === activeScript.id && executingCell?.cellId === cell.id;

        return (
          <SqlCell
            key={cell.id}
            scriptId={activeScript.id}
            cell={cell}
            index={index}
            isSelected={isSelected}
            isRunning={isRunning}
            canRemove={activeScript.cells.length > 1}
            isCollapsed={Boolean(collapsedCells[cell.id])}
            sqlExtension={sqlExtension}
            onSelect={() => setSelectedScriptCell(activeScript.id, cell.id)}
            onChange={(value) => {
              if (activeScript.selectedCellId !== cell.id) {
                setSelectedScriptCell(activeScript.id, cell.id);
              }
              updateScriptContent(activeScript.id, value);
            }}
            onRun={() => executeScriptCell(activeScript.id, cell.id)}
            onRemove={() => removeScriptCell(activeScript.id, cell.id)}
            onToggleCollapse={() => toggleCellCollapse(cell.id)}
          />
        );
      })}

      <button
        onClick={handleAddCell}
        className="group mx-auto flex w-fit h-9 px-4 rounded-full border border-base-600/80 bg-base-800/95 hover:bg-base-750 text-base-100 transition-colors items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4 text-accent-300 group-hover:text-accent-200" />
        <span className="text-sm font-medium tracking-wide">Add Cell</span>
      </button>
    </div>
  );
}
