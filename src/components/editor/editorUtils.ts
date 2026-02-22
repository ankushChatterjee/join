import { EditorView } from "@codemirror/view";
import { format } from "sql-formatter";
import { useAppStore } from "@/stores/appStore";
import type { DatabaseType } from "@/stores/types";

// Store editor view reference for query execution
let editorView: EditorView | null = null;
let activeEditorCellId: string | null = null;

export function setEditorView(view: EditorView | null, cellId?: string | null) {
  editorView = view;
  if (cellId !== undefined) {
    activeEditorCellId = cellId;
  }
}

export function getEditorView(): EditorView | null {
  return editorView;
}

function getActiveScript() {
  const { openScripts, activeScriptId, activeEditorTab } = useAppStore.getState();
  if (activeEditorTab?.kind === "result") {
    return null;
  }
  return openScripts.find((s) => s.id === activeScriptId) ?? null;
}

function getActiveResultTab() {
  const { openResultTabs, activeEditorTab } = useAppStore.getState();
  if (activeEditorTab?.kind !== "result") {
    return null;
  }
  return openResultTabs.find((t) => t.id === activeEditorTab.id) ?? null;
}

function getSelectedCellSql(): string {
  const resultTab = getActiveResultTab();
  if (resultTab) {
    return resultTab.sqlCell.sql ?? "";
  }

  const activeScript = getActiveScript();
  if (!activeScript) return "";

  const selectedCellId = activeScript.selectedCellId ?? activeEditorCellId;
  if (!selectedCellId) return "";

  return activeScript.cells.find((cell) => cell.id === selectedCellId)?.sql ?? "";
}

// Get selected text if any, otherwise return active selected cell content
export function getQueryToRun(): string {
  const content = getSelectedCellSql();
  
  if (editorView) {
    const selection = editorView.state.selection.main;
    if (!selection.empty) {
      return editorView.state.sliceDoc(selection.from, selection.to);
    }
  }
  return content;
}

// Get the effective connection ID for the active script
export function getEffectiveConnectionId(): string | null {
  const activeResultTab = getActiveResultTab();
  if (activeResultTab) {
    return activeResultTab.connectionId;
  }
  const activeScript = getActiveScript();
  return activeScript?.connectionId ?? null;
}

// Map database type to sql-formatter language
function getFormatterLanguage(dbType: DatabaseType): "postgresql" | "mysql" | "sqlite" {
  switch (dbType) {
    case "postgresql":
      return "postgresql";
    case "mysql":
      return "mysql";
    case "sqlite":
      return "sqlite";
    default:
      return "postgresql";
  }
}

// Format the editor content using sql-formatter
export function formatEditorContent(dialect: DatabaseType): void {
  const view = getEditorView();
  if (!view) return;

  const content = view.state.doc.toString();
  if (!content.trim()) return;

  try {
    const formatted = format(content, {
      language: getFormatterLanguage(dialect),
      keywordCase: "upper",
      indentStyle: "standard",
      logicalOperatorNewline: "before",
    });

    // Replace entire content with formatted version
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
    });

    // Also update the selected cell in the store so the sheet is marked dirty
    const activeScript = getActiveScript();
    const activeResultTab = getActiveResultTab();
    if (activeScript) {
      useAppStore.getState().updateScriptContent(activeScript.id, formatted);
    } else if (activeResultTab) {
      useAppStore.getState().updateResultTabSql(activeResultTab.id, formatted);
    }
  } catch (error) {
    console.error("Failed to format SQL:", error);
    // If formatting fails, just leave content as-is
  }
}

// Insert text at the current cursor position
export function insertTextAtCursor(text: string): void {
  const view = getEditorView();
  if (!view) return;

  const { from } = view.state.selection.main;
  
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
  });
  
  view.focus();

  // Also update the selected cell in the store
  const activeScript = getActiveScript();
  const activeResultTab = getActiveResultTab();
  const newContent = view.state.doc.toString();
  if (activeScript) {
    useAppStore.getState().updateScriptContent(activeScript.id, newContent);
  } else if (activeResultTab) {
    useAppStore.getState().updateResultTabSql(activeResultTab.id, newContent);
  }
}

// Get currently selected text in the editor
export function getSelectedText(): string | null {
  if (!editorView) return null;
  const selection = editorView.state.selection.main;
  if (selection.empty) return null;
  return editorView.state.sliceDoc(selection.from, selection.to);
}

// Get the full content of the editor
export function getFullEditorContent(): string {
  if (editorView) {
    return editorView.state.doc.toString();
  }
  return getSelectedCellSql();
}

// Get cursor position in the editor
export function getCursorPosition(): { line: number; col: number } | null {
  if (!editorView) return null;
  const pos = editorView.state.selection.main.head;
  const line = editorView.state.doc.lineAt(pos);
  return { line: line.number, col: pos - line.from + 1 };
}

// Replace the entire editor content
export function replaceEditorContent(text: string): void {
  const view = getEditorView();
  if (!view) return;

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });

  view.focus();

  // Also update the selected cell in the store
  const activeScript = getActiveScript();
  const activeResultTab = getActiveResultTab();
  if (activeScript) {
    useAppStore.getState().updateScriptContent(activeScript.id, text);
  } else if (activeResultTab) {
    useAppStore.getState().updateResultTabSql(activeResultTab.id, text);
  }
}

// Generate SELECT statement for a table
export function generateSelectStatement(
  schema: string,
  tableName: string,
  columns?: string[]
): string {
  const columnList = columns && columns.length > 0 
    ? columns.join(",\n  ") 
    : "*";
  
  const formattedColumns = columns && columns.length > 0
    ? `\n  ${columnList}\n`
    : " * ";

  return `SELECT${formattedColumns}FROM ${schema}.${tableName}\nLIMIT 100;\n`;
}
