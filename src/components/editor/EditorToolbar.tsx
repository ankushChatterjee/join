import { Play, Loader2, AlignLeft } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { getQueryToRun, getEffectiveConnectionId, formatEditorContent } from "./editorUtils";
import { EditorTabs } from "./EditorTabs";

export function EditorToolbar() {
  const {
    executeQuery,
    isExecuting,
    connections,
    openScripts,
    activeScriptId,
  } = useAppStore();

  // Get the active script's connection to determine dialect
  const activeScript = openScripts.find((s) => s.id === activeScriptId);
  const activeConnection = connections.find((c) => c.id === activeScript?.connectionId);
  const dialect = activeConnection?.db_type ?? "postgresql";

  const handleRun = () => {
    const connectionId = getEffectiveConnectionId();
    if (!connectionId) {
      alert("Please connect to a database first");
      return;
    }
    const sql = getQueryToRun();
    if (sql.trim()) {
      executeQuery(sql.trim());
    }
  };

  const handleFormat = () => {
    formatEditorContent(dialect);
  };

  const connectionId = getEffectiveConnectionId();

  return (
    <div className="h-10 px-3 flex items-center gap-2 border-b border-border-subtle bg-surface/80 backdrop-blur-sm shrink-0">
      {/* Run button - minimal icon-only style */}
      <button
        onClick={handleRun}
        disabled={!connectionId || isExecuting}
        className="w-7 h-7 flex items-center justify-center rounded text-base-200 hover:text-base-50 hover:bg-base-700/50 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="Run query (⌘+Enter)"
      >
        {isExecuting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" fill="currentColor" />
        )}
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
      <div className="text-xs text-base-500 hidden xl:flex items-center gap-1 shrink-0 ml-2">
        <kbd className="px-1.5 py-0.5 rounded bg-base-800 border border-base-700 font-mono text-base-400">
          ⌘↵
        </kbd>
        <span className="text-base-500">run</span>
      </div>
    </div>
  );
}
