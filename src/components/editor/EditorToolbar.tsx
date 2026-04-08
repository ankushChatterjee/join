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
    activeEditorTab,
  } = useAppStore(
    useShallow((state) => ({
      connections: state.connections,
      openScripts: state.openScripts,
      activeScriptId: state.activeScriptId,
      addScriptCell: state.addScriptCell,
      activeEditorTab: state.activeEditorTab,
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
  const isResultTab = activeEditorTab?.kind === "result";

  return (
    <div className="h-[32px] px-2 flex items-center gap-2 border-b border-base-800 bg-base-900/70 shrink-0">
      <EditorTabs />

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <button
          onClick={handleFormat}
          disabled={!connectionId || isResultTab}
          className="h-6 px-2 flex items-center justify-center gap-1 rounded-sm border border-base-700/80 text-base-300 hover:text-base-100 hover:bg-base-850 transition-colors-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Format SQL (Shift+Alt+F)"
        >
          <AlignLeft className="w-3 h-3" strokeWidth={1.8} />
          <span className="text-[11px]">Format</span>
        </button>
        <button
          onClick={handleAddCell}
          disabled={!activeScriptId || isResultTab}
          className="h-6 px-2 flex items-center justify-center gap-1 rounded-sm border border-base-700/80 text-base-300 hover:text-base-100 hover:bg-base-850 transition-colors-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Add cell"
        >
          <Plus className="w-3 h-3" strokeWidth={1.8} />
          <span className="text-[11px]">Cell</span>
        </button>
      </div>
    </div>
  );
}
