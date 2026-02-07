import {
  Panel,
  Group,
  Separator,
} from "react-resizable-panels";
import { Database, Zap, FileCode2, Plus } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { SqlEditor } from "@/components/editor/SqlEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { ResultsPanel } from "@/components/results/ResultsPanel";
import { useAppStore } from "@/stores/appStore";

function NoConnectionState() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-surface relative overflow-hidden">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.02]">
        <div 
          className="absolute inset-0" 
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }}
        />
      </div>
      
      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-accent-500/[0.03] rounded-full blur-3xl pointer-events-none" />
      
      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-8">
        {/* Icon */}
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-base-750 to-base-800 flex items-center justify-center border border-base-700/50 shadow-lg shadow-black/20">
            <Database className="w-7 h-7 text-base-300" strokeWidth={1.5} />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-accent-500/20 flex items-center justify-center border border-accent-500/30">
            <Zap className="w-3 h-3 text-accent-400" />
          </div>
        </div>
        
        {/* Text */}
        <h2 className="text-lg font-semibold text-base-200 mb-2">
          No active connection
        </h2>
        <p className="text-sm text-base-300 max-w-[280px] leading-relaxed">
          Connect to a database from the sidebar to start writing queries
        </p>
        
        {/* Keyboard hint */}
        <div className="mt-8 flex items-center gap-2 text-xs text-base-400">
          <span>or press</span>
          <kbd className="px-2 py-1 rounded bg-base-800 border border-base-700 font-mono text-base-300">
            ⌘ N
          </kbd>
          <span>to add a connection</span>
        </div>
      </div>
    </div>
  );
}

function NoScriptsState() {
  const { activeConnectionId, connections, createScript } = useAppStore();
  
  // Find any connected database to use for new script
  const connectedDb = connections.find((c) => c.is_connected);
  const canCreateScript = activeConnectionId || connectedDb;

  const handleNewScript = async () => {
    const connectionId = activeConnectionId || connectedDb?.id;
    if (connectionId) {
      await createScript(connectionId);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center bg-surface relative overflow-hidden">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.015]">
        <div 
          className="absolute inset-0" 
          style={{
            backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
                              linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
          }}
        />
      </div>
      
      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-8">
        {/* Icon */}
        <div className="mb-5">
          <div className="w-12 h-12 rounded-xl bg-base-800/80 flex items-center justify-center border border-base-700/50">
            <FileCode2 className="w-5 h-5 text-base-400" strokeWidth={1.5} />
          </div>
        </div>
        
        {/* Text */}
        <h2 className="text-base font-medium text-base-300 mb-1.5">
          No open scripts
        </h2>
        <p className="text-sm text-base-400 mb-5">
          {canCreateScript 
            ? "Create a new script to start writing queries"
            : "Connect to a database first, then create a script"}
        </p>
        
        {/* New script button */}
        {canCreateScript && (
          <button
            onClick={handleNewScript}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-base-800 hover:bg-base-750 border border-base-700/50 text-sm text-base-300 hover:text-base-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New script</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function MainLayout() {
  const { connections, openScripts } = useAppStore();
  
  // Check if any connection exists (not necessarily connected)
  const hasAnyConnection = connections.length > 0;
  const hasOpenScripts = openScripts.length > 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      {/* Custom Title Bar */}
      <TitleBar />
      
      <Group orientation="horizontal" className="flex-1">
        {/* Left Sidebar */}
        <Panel defaultSize="18%" minSize="14%" maxSize="30%">
          <Sidebar />
        </Panel>
        
        <Separator className="w-px bg-border-subtle hover:bg-accent-500 transition-colors data-[separator-active]:bg-accent-500" />
        
        {/* Main Content Area */}
        <Panel defaultSize="82%" minSize="50%">
          {!hasAnyConnection && !hasOpenScripts ? (
            <NoConnectionState />
          ) : !hasOpenScripts ? (
            <NoScriptsState />
          ) : (
            <Group orientation="vertical" className="h-full">
              {/* Editor Area */}
              <Panel defaultSize="65%" minSize="30%">
                <div className="h-full flex flex-col bg-surface">
                  <EditorToolbar />
                  <div className="flex-1 overflow-hidden">
                    <SqlEditor />
                  </div>
                </div>
              </Panel>
              
              <Separator className="h-px bg-border-subtle hover:bg-accent-500 transition-colors data-[separator-active]:bg-accent-500" />
              
              {/* Results Panel */}
              <Panel defaultSize="35%" minSize="15%" maxSize="70%">
                <ResultsPanel />
              </Panel>
            </Group>
          )}
        </Panel>
      </Group>
    </div>
  );
}
