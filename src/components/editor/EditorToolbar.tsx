import { Plus, AlignLeft } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { getEffectiveConnectionId, formatEditorContent } from "./editorUtils";
import { EditorTabs } from "./EditorTabs";
import { useShallow } from "zustand/react/shallow";

export function EditorToolbar() {
  const {
    connections,
    openScripts,
    activeScriptId,
    addScriptCell,
  } = useAppStore(
    useShallow((state) => ({
      connections: state.connections,
      openScripts: state.openScripts,
      activeScriptId: state.activeScriptId,
      addScriptCell: state.addScriptCell,
    }))
  );

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
    <div className="h-[34px] px-2.5 flex items-center gap-1.5 border-b border-base-750 bg-base-900/95 shrink-0">
      {/* Add cell button */}
      <button
        onClick={handleAddCell}
        disabled={!activeScriptId}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-base-200 hover:text-base-50 hover:bg-base-800 transition-colors-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="Add cell"
      >
        <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
      </button>

      {/* Format button */}
      <button
        onClick={handleFormat}
        disabled={!connectionId}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-base-200 hover:text-base-50 hover:bg-base-800 transition-colors-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="Format SQL (Shift+Alt+F)"
      >
        <AlignLeft className="w-3.5 h-3.5" strokeWidth={1.8} />
      </button>

      {/* Divider */}
      <div className="w-px h-4 bg-base-700 shrink-0" />

      {/* Editor Tabs */}
      <EditorTabs />

      {/* Keyboard shortcut hint */}
      <div className="text-[11px] text-base-200 hidden xl:flex items-center gap-1 shrink-0 ml-1.5">
        <kbd className="px-1 py-0.5 rounded-sm bg-base-850 border border-base-700 font-mono text-[11px] text-base-100">
          ⌘↵
        </kbd>
        <span className="text-base-300">run cell</span>
      </div>
    </div>
  );
}
