import { useCallback, useRef, useMemo, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL, MySQL, SQLite } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { useAppStore } from "@/stores/appStore";
import { setEditorView } from "./editorUtils";
import { buildCompletionSchema } from "./completionSchema";

// Custom dark theme for CodeMirror - warm retro palette with high contrast
const customTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#1a1815",
      color: "#e8e4db",
    },
    ".cm-content": {
      caretColor: "#d4b896",
      fontFamily: "var(--font-mono)",
      padding: "12px 0",
    },
    // Block cursor style
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
      backgroundColor: "#14120f",
      color: "#6e6456",
      border: "none",
      borderRight: "1px solid #2e2a25",
      paddingRight: "8px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      paddingLeft: "16px",
      minWidth: "40px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#1e1c19",
      color: "#a09382",
    },
    ".cm-activeLine": {
      backgroundColor: "#1e1c19",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(184, 149, 108, 0.2)",
      color: "#d4b896 !important",
      outline: "1px solid #b8956c",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#25221e",
      border: "none",
      color: "#6e6456",
    },
  },
  { dark: true }
);

// Syntax highlighting using HighlightStyle for proper token coloring
const sqlHighlightStyle = HighlightStyle.define([
  // Keywords (SELECT, FROM, WHERE, etc.) - bright cream for maximum contrast
  { tag: tags.keyword, color: "#f0ebe0", fontWeight: "600" },
  // Strings
  { tag: tags.string, color: "#a3d9a5" },
  // Numbers
  { tag: tags.number, color: "#e8a870" },
  // Comments
  { tag: tags.comment, color: "#7a7060", fontStyle: "italic" },
  // Operators
  { tag: tags.operator, color: "#d4c8b0" },
  // Punctuation
  { tag: tags.punctuation, color: "#c4b8a5" },
  // Type names
  { tag: tags.typeName, color: "#d4b896" },
  // Built-in/standard names
  { tag: tags.standard(tags.name), color: "#e0b8a0" },
  // Function names
  { tag: tags.function(tags.name), color: "#e0b8a0" },
  // Variable/column names
  { tag: tags.variableName, color: "#d8cbb8" },
  // Property names (table.column)
  { tag: tags.propertyName, color: "#d8cbb8" },
  // Definition names
  { tag: tags.definition(tags.name), color: "#d8cbb8" },
  // Special variables
  { tag: tags.special(tags.variableName), color: "#d4b896" },
]);

export function SqlEditor() {
  console.warn("=== SqlEditor RENDERING ==="); // Debug: confirm component renders
  
  const { 
    executeQuery, 
    connections,
    openScripts,
    activeScriptId,
    updateScriptContent,
    tablesBySchema,
    viewsBySchema,
    columns,
  } = useAppStore();
  const viewRef = useRef<EditorView | null>(null);

  // Get the active script
  const activeScript = useMemo(
    () => openScripts.find((s) => s.id === activeScriptId),
    [openScripts, activeScriptId]
  );

  // Use the script's connection
  const effectiveConnectionId = activeScript?.connectionId ?? null;

  // Get the active connection to determine SQL dialect
  const activeConnection = connections.find((c) => c.id === effectiveConnectionId);
  const dialect =
    activeConnection?.db_type === "mysql"
      ? MySQL
      : activeConnection?.db_type === "sqlite"
      ? SQLite
      : PostgreSQL;

  // Build completion schema from store metadata (memoized for performance)
  const completionSchema = useMemo(
    () => buildCompletionSchema(tablesBySchema, viewsBySchema, columns),
    [tablesBySchema, viewsBySchema, columns]
  );

  // Debug: log schema when it changes
  useEffect(() => {
    console.warn("=== AUTOCOMPLETE DEBUG ===");
    console.warn("Schema keys:", Object.keys(completionSchema));
    console.warn("Tables by schema:", tablesBySchema);
    console.warn("Columns:", columns);
    console.warn("Full completion schema:", completionSchema);
  }, [completionSchema, tablesBySchema, columns]);

  // Memoize the SQL extension to prevent recreation on every render
  const sqlExtension = useMemo(
    () => sql({ dialect, schema: completionSchema, upperCaseKeywords: true }),
    [dialect, completionSchema]
  );

  // Use a ref to always have the latest execute function available to the keymap
  const handleExecuteRef = useRef<() => void>(() => {});

  const handleExecute = useCallback(() => {
    if (!effectiveConnectionId) {
      alert("Please connect to a database first");
      return;
    }

    // Get selected text or full content from the current view
    const view = viewRef.current;
    let queryToRun = activeScript?.content ?? "";

    if (view) {
      const selection = view.state.selection.main;
      if (!selection.empty) {
        queryToRun = view.state.sliceDoc(selection.from, selection.to);
      }
    }

    if (queryToRun.trim()) {
      executeQuery(queryToRun.trim());
    }
  }, [effectiveConnectionId, executeQuery, activeScript?.content]);

  // Keep the ref updated with the latest handleExecute
  useEffect(() => {
    handleExecuteRef.current = handleExecute;
  }, [handleExecute]);

  const onChange = useCallback((val: string) => {
    if (activeScriptId) {
      updateScriptContent(activeScriptId, val);
    }
  }, [activeScriptId, updateScriptContent]);

  // Keyboard shortcut for running query - use Prec.highest to override default bindings
  // and call through ref to avoid stale closure issues
  const runQueryKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              handleExecuteRef.current();
              return true;
            },
          },
        ])
      ),
    []
  );

  return (
    <div className="h-full w-full overflow-hidden">
      <CodeMirror
        key={activeScriptId} // Force remount on script change
        value={activeScript?.content ?? ""}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          setEditorView(view);
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
        className="h-full text-sm"
      />
    </div>
  );
}
