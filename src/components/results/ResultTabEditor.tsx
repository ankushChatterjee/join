import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play, Save, Download, Loader2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useShallow } from "zustand/react/shallow";
import { ResultsView } from "./ResultsView";
import { DiffViewer } from "@/components/editor/DiffViewer";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL, MySQL, SQLite } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { buildCompletionSchema } from "@/components/editor/completionSchema";
import { setEditorView } from "@/components/editor/editorUtils";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

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
      backgroundColor: "rgba(42, 42, 42, 0.4)",
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

export function ResultTabEditor() {
  const [isExporting, setIsExporting] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const {
    activeEditorTab,
    openResultTabs,
    connections,
    tablesBySchema,
    viewsBySchema,
    columns,
    refreshResultTab,
    updateResultTabSql,
    acceptResultTabProposal,
    rejectResultTabProposal,
    toggleResultQueryExpanded,
    saveCurrentResults,
    showToast,
    isExecuting,
  } = useAppStore(
    useShallow((state) => ({
      activeEditorTab: state.activeEditorTab,
      openResultTabs: state.openResultTabs,
      connections: state.connections,
      tablesBySchema: state.tablesBySchema,
      viewsBySchema: state.viewsBySchema,
      columns: state.columns,
      refreshResultTab: state.refreshResultTab,
      updateResultTabSql: state.updateResultTabSql,
      acceptResultTabProposal: state.acceptResultTabProposal,
      rejectResultTabProposal: state.rejectResultTabProposal,
      toggleResultQueryExpanded: state.toggleResultQueryExpanded,
      saveCurrentResults: state.saveCurrentResults,
      showToast: state.showToast,
      isExecuting: state.isExecuting,
    }))
  );

  const activeTab = useMemo(() => {
    if (activeEditorTab?.kind !== "result") return null;
    return openResultTabs.find((tab) => tab.id === activeEditorTab.id) ?? null;
  }, [activeEditorTab, openResultTabs]);

  const connection = connections.find((c) => c.id === activeTab?.connectionId);
  const dbType = connection?.db_type;
  const activeTabId = activeTab?.id ?? null;
  const proposedSql = activeTab?.sqlCell.proposed_sql ?? null;
  const dialect =
    dbType === "mysql" ? MySQL : dbType === "sqlite" ? SQLite : PostgreSQL;
  const completionSchema = useMemo(
    () => buildCompletionSchema(tablesBySchema, viewsBySchema, columns),
    [tablesBySchema, viewsBySchema, columns]
  );
  const sqlExtension = useMemo(
    () => sql({ dialect, schema: completionSchema, upperCaseKeywords: true }),
    [dialect, completionSchema]
  );
  const runQueryKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              if (activeTabId) {
                refreshResultTab(activeTabId);
              }
              return true;
            },
          },
        ])
      ),
    [activeTabId, refreshResultTab]
  );
  const preview = activeTab?.sqlCell.sql.replace(/\s+/g, " ").trim() ?? "";

  const handleExport = async () => {
    if (!activeTab || !activeTab.queryResults || isExporting) return;
    try {
      setIsExporting(true);
      const filePath = await save({
        filters: [{ name: "CSV", extensions: ["csv"] }],
        defaultPath: "export.csv",
      });
      if (!filePath) return;
      await invoke("export_to_csv", {
        filePath,
        data: {
          columns: activeTab.queryResults.columns.map((c) => c.name),
          rows: activeTab.queryResults.rows,
        },
      });
      showToast("success", "Exported successfully");
    } catch (error) {
      showToast("error", `Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrentResults();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saveCurrentResults]);

  useEffect(() => {
    if (proposedSql) {
      setEditorView(null, null);
    }
  }, [proposedSql]);

  if (!activeTab) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-base-300">
        Open a result tab to continue
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="border-b border-base-750 bg-base-900/95">
        <button
          onClick={() => toggleResultQueryExpanded(activeTab.id)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-base-850 transition-colors-fast"
        >
          {activeTab.isQueryCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-base-300 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-base-300 shrink-0" />
          )}
          <span className="text-[11px] uppercase tracking-[0.08em] text-base-300">Query</span>
          <div className="flex-1 truncate text-[12px] text-base-200 font-mono">
            {preview || "Empty query"}
          </div>
        </button>

        {!activeTab.isQueryCollapsed && (
          <div className="px-2.5 pb-2">
            {activeTab.sqlCell.proposed_sql ? (
              <DiffViewer
                oldValue={activeTab.sqlCell.sql}
                newValue={activeTab.sqlCell.proposed_sql}
                onAccept={() => acceptResultTabProposal(activeTab.id)}
                onReject={() => rejectResultTabProposal(activeTab.id)}
              />
            ) : (
              <CodeMirror
                value={activeTab.sqlCell.sql}
                onChange={(value) => updateResultTabSql(activeTab.id, value)}
                onCreateEditor={(view) => {
                  viewRef.current = view;
                  setEditorView(view, activeTab.sqlCell.id);
                }}
                onFocus={() => {
                  if (viewRef.current) {
                    setEditorView(viewRef.current, activeTab.sqlCell.id);
                  }
                }}
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
                  autocompletion: true,
                  rectangularSelection: true,
                  crosshairCursor: false,
                  highlightSelectionMatches: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  closeBracketsKeymap: true,
                  searchKeymap: true,
                  foldKeymap: true,
                  completionKeymap: true,
                  lintKeymap: true,
                }}
                className="text-[14px] border border-base-800"
              />
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <ResultsView
          queryResults={activeTab.queryResults}
          previewSource={activeTab.previewSource}
          dbType={dbType}
          emptyMessage="No result data loaded"
          rightActions={
            <div className="flex items-center gap-1">
              <button
                onClick={() => refreshResultTab(activeTab.id)}
                disabled={isExecuting}
                className="h-[20px] px-2 flex items-center justify-center gap-1 rounded-none border border-accent-500/35 text-accent-300 hover:bg-accent-500/8 disabled:opacity-50 disabled:cursor-not-allowed transition-colors-fast text-[11px] font-semibold"
                title="Run query (⌘+Enter)"
              >
                {isExecuting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <>
                    <Play className="w-3 h-3" fill="currentColor" />
                    <span>RUN</span>
                  </>
                )}
              </button>
              <button
                onClick={saveCurrentResults}
                className="relative flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast text-[11px]"
                title="Save result"
              >
                <Save className="w-3 h-3" />
                <span>Save</span>
                {(activeTab.isDirty || !activeTab.savedResultId) && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-warning border border-base-900"
                    title="Unsaved changes"
                  />
                )}
              </button>
              <button
                onClick={handleExport}
                disabled={!activeTab.queryResults || isExporting}
                className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast text-[11px] disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export to CSV"
              >
                <Download className="w-3 h-3" />
                <span>Export</span>
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
