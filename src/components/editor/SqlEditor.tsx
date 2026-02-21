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
import { DiffViewer } from "./DiffViewer";

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
      padding: "8px 0",
      minHeight: "104px",
    },
    ".cm-cursor": {
      borderLeft: "none",
      backgroundColor: "#f48734",
      width: "0.6em",
      marginLeft: "0",
    },
    ".cm-selectionBackground": {
      backgroundColor: "rgba(244, 135, 52, 0.14) !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(244, 135, 52, 0.2) !important",
    },
    ".cm-gutters": {
      backgroundColor: "#0a0c10",
      color: "#7f8da0",
      border: "none",
      borderRight: "1px solid #1d2430",
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
      backgroundColor: "rgba(40, 49, 64, 0.4)",
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
        "rounded-sm border transition-colors-fast overflow-hidden",
        isSelected ? "border-base-600 bg-base-900" : "border-base-750 bg-base-900/85"
      )}
      data-script-id={scriptId}
      data-cell-id={cell.id}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 border-b",
          isSelected ? "border-base-700 bg-base-850/80" : "border-base-800 bg-base-900"
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-[22px] h-[22px] flex items-center justify-center rounded-sm text-base-300 hover:text-base-100 hover:bg-base-800 transition-colors-fast"
          title={isCollapsed ? "Expand cell" : "Collapse cell"}
        >
          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        <div
          className={cn(
            "min-w-[20px] h-[20px] px-1 rounded-sm text-[11px] font-semibold font-mono flex items-center justify-center border",
            isSelected ? "bg-base-800 text-base-100 border-base-600" : "bg-base-900 text-base-300 border-base-700"
          )}
        >
          {index + 1}
        </div>

        <span className="text-[11px] text-base-200 truncate tracking-[0.02em]">{formatRunInfo(cell)}</span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onRun}
            disabled={isRunning}
            className="w-[22px] h-[22px] flex items-center justify-center rounded-sm border border-accent-500/50 text-accent-300 hover:bg-accent-500/14 disabled:opacity-50 disabled:cursor-not-allowed transition-colors-fast"
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
            className="w-[22px] h-[22px] flex items-center justify-center rounded-sm text-base-300 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors-fast"
            title={canRemove ? "Remove cell" : "Cannot remove the only cell"}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {cell.proposed_sql ? (
        <div className="p-1.5 bg-base-900 border-t border-base-800">
          <DiffViewer
            oldValue={cell.sql}
            newValue={cell.proposed_sql}
            onAccept={() => useAppStore.getState().acceptScriptCellProposal(scriptId, cell.id)}
            onReject={() => useAppStore.getState().rejectScriptCellProposal(scriptId, cell.id)}
          />
        </div>
      ) : isCollapsed ? (
        <div className="px-2.5 py-1.5 text-[12px] text-base-200 font-mono bg-base-900 border-t border-base-800">{preview}</div>
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
          className="text-[14px] border-t border-base-800"
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
    <div className="h-full w-full overflow-auto p-1 space-y-1.5 panel-scroll scrollbar-stable">
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
        className="group mx-auto flex w-fit h-7 px-2.5 rounded-sm border border-base-700 bg-base-900 hover:bg-base-850 text-base-200 transition-colors-fast items-center justify-center gap-1.5"
      >
        <Plus className="w-3 h-3 text-accent-300 group-hover:text-accent-200" />
        <span className="text-[12px] font-medium tracking-[0.02em]">Add cell</span>
      </button>
    </div>
  );
}
