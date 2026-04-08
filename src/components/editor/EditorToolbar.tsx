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
    <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-base-800/80 bg-base-900 px-3">
      <EditorTabs />

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <button
          onClick={handleFormat}
          disabled={!connectionId || isResultTab}
          className="flex h-8 items-center justify-center gap-1.5 border border-transparent px-2.5 text-[12px] font-medium text-base-100 transition-colors-fast cursor-pointer hover:bg-base-850 hover:text-base-100 disabled:cursor-not-allowed disabled:opacity-50"
          title="Format SQL (Shift+Alt+F)"
        >
          <AlignLeft className="w-3.5 h-3.5" strokeWidth={1.8} />
          <span>Format</span>
        </button>
        <button
          onClick={handleAddCell}
          disabled={!activeScriptId || isResultTab}
          className="flex h-8 items-center justify-center gap-1.5 border border-transparent px-2.5 text-[12px] font-medium text-base-100 transition-colors-fast cursor-pointer hover:bg-base-850 hover:text-base-100 disabled:cursor-not-allowed disabled:opacity-50"
          title="Add cell"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
          <span>Cell</span>
        </button>
      </div>
    </div>
  );
}
