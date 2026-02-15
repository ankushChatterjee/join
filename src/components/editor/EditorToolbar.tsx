import { Plus, AlignLeft } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { getEffectiveConnectionId, formatEditorContent } from "./editorUtils";
import { EditorTabs } from "./EditorTabs";

export function EditorToolbar() {
  const {
    connections,
    openScripts,
    activeScriptId,
    addScriptCell,
  } = useAppStore();

  // Get the active script's connection to determine dialect
  const activeScript = openScripts.find((s) => s.id === activeScriptId);
  const activeConnection = connections.find((c) => c.id === activeScript?.connectionId);
  const dialect = activeConnection?.db_type ?? "postgresql";

  const handleAddCell = async () => {
    if (!activeScriptId) return;
    await addScriptCell(activeScriptId, "", true);
  };

  const handleFormat = () => {
    formatEditorContent(dialect);
  };

  const connectionId = getEffectiveConnectionId();

  return (
    <div className="h-10 px-3 flex items-center gap-2 border-b border-border-subtle bg-surface/80 backdrop-blur-sm shrink-0">
      {/* Add cell button */}
      <button
        onClick={handleAddCell}
        disabled={!activeScriptId}
        className="w-7 h-7 flex items-center justify-center rounded text-base-200 hover:text-base-50 hover:bg-base-700/50 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="Add cell"
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Format button */}
      <button
        onClick={handleFormat}
        disabled={!connectionId}
        className="w-7 h-7 flex items-center justify-center rounded text-base-200 hover:text-base-50 hover:bg-base-700/50 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="Format SQL (Shift+Alt+F)"
      >
        <AlignLeft className="w-4 h-4" />
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-border-subtle shrink-0" />

      {/* Editor Tabs */}
      <EditorTabs />

      {/* Keyboard shortcut hint */}
      <div className="text-xs text-base-300 hidden xl:flex items-center gap-1 shrink-0 ml-2">
        <kbd className="px-1.5 py-0.5 rounded bg-base-800 border border-base-700 font-mono text-base-200">
          ⌘↵
        </kbd>
        <span className="text-base-300">run cell</span>
      </div>
    </div>
  );
}
