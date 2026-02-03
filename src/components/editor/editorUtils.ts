import { EditorView } from "@codemirror/view";
import { useAppStore } from "@/stores/appStore";

// Store editor view reference for query execution
let editorView: EditorView | null = null;

export function setEditorView(view: EditorView | null) {
  editorView = view;
}

export function getEditorView(): EditorView | null {
  return editorView;
}

// Get selected text if any, otherwise return active script's content
export function getQueryToRun(): string {
  const { openScripts, activeScriptId } = useAppStore.getState();
  const activeScript = openScripts.find((s) => s.id === activeScriptId);
  const content = activeScript?.content ?? "";
  
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
  const { openScripts, activeScriptId } = useAppStore.getState();
  const activeScript = openScripts.find((s) => s.id === activeScriptId);
  return activeScript?.connectionId ?? null;
}
