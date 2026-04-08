import { useEffect, useState } from "react";
import {
  Panel,
  Group,
  Separator,
} from "react-resizable-panels";
import { Database, Zap, FileCode2, Plus, PanelLeftOpen, PanelBottomOpen } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { SqlEditor } from "@/components/editor/SqlEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { ResultsPanel } from "@/components/results/ResultsPanel";
import { ResultTabEditor } from "@/components/results/ResultTabEditor";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { useAppStore } from "@/stores/appStore";
import { useShallow } from "zustand/react/shallow";

function NoConnectionState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="relative mb-4 flex h-12 w-12 items-center justify-center bg-base-900/85">
          <Database className="w-5 h-5 text-base-200" strokeWidth={1.6} />
          <Zap className="absolute w-3 h-3 text-accent-500 translate-x-3 translate-y-3" />
        </div>
        <h2 className="mb-2 text-xl font-semibold tracking-[-0.02em] text-base-50">
          No active connection
        </h2>
        <p className="max-w-[340px] text-[15px] leading-7 text-base-200">
          Connect to a database from the sidebar to start writing queries
        </p>
        <div className="mt-6 flex items-center gap-2 text-xs text-base-400">
          <span>or press</span>
          <kbd className="bg-base-850/90 px-2 py-0.5 font-mono text-base-200">
            ⌘ N
          </kbd>
          <span>to add a connection</span>
        </div>
      </div>
    </div>
  );
}

function NoSheetsState() {
  const { activeConnectionId, connections, createScript } = useAppStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      createScript: state.createScript,
    }))
  );

  // Find any connected database to use for new sheet
  const connectedDb = connections.find((c) => c.is_connected);
  const canCreateScript = activeConnectionId || connectedDb;

  const handleNewScript = async () => {
    const connectionId = activeConnectionId || connectedDb?.id;
    if (connectionId) {
      await createScript(connectionId);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center bg-base-900/85">
          <FileCode2 className="w-4 h-4 text-base-200" strokeWidth={1.6} />
        </div>
        <h2 className="mb-2 text-xl font-semibold tracking-[-0.02em] text-base-50">
          No open SQL sheets
        </h2>
        <p className="mb-5 text-[15px] text-base-200">
          {canCreateScript
            ? "Create a SQL sheet to start writing queries"
            : "Connect to a database first, then create a SQL sheet"}
        </p>
        {canCreateScript && (
          <button
            onClick={handleNewScript}
            className="flex items-center gap-1.5 bg-accent-500/10 px-3.5 py-2 text-xs font-medium text-base-100 transition-colors-fast hover:bg-accent-500/16"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New SQL sheet</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function MainLayout() {
  const {
    connectionsCount,
    openScriptsCount,
    openResultTabsCount,
    activeEditorTab,
    isResultsPanelMinimized,
    toggleResultsPanelMinimized,
  } = useAppStore(
    useShallow((state) => ({
      connectionsCount: state.connections.length,
      openScriptsCount: state.openScripts.length,
      openResultTabsCount: state.openResultTabs.length,
      activeEditorTab: state.activeEditorTab,
      isResultsPanelMinimized: state.isResultsPanelMinimized,
      toggleResultsPanelMinimized: state.toggleResultsPanelMinimized,
    }))
  );
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("join:left-sidebar-open");
    return saved === null ? true : saved === "true";
  });

  // Check if any connection exists (not necessarily connected)
  const hasAnyConnection = connectionsCount > 0;
  const hasOpenTabs = openScriptsCount > 0 || openResultTabsCount > 0;
  const isResultTabActive = activeEditorTab?.kind === "result";

  useEffect(() => {
    window.localStorage.setItem("join:left-sidebar-open", String(isLeftSidebarOpen));
  }, [isLeftSidebarOpen]);

  return (
    <div className="app-texture flex h-screen w-screen flex-col overflow-hidden bg-background">
      <TitleBar />

      <Group orientation="horizontal" className="flex-1">
        {isLeftSidebarOpen ? (
          <>
            <Panel id="sidebar" defaultSize="18%" minSize="14%" maxSize="30%">
              <Sidebar onCollapse={() => setIsLeftSidebarOpen(false)} />
            </Panel>
            <Separator className="w-px bg-base-750 transition-colors-fast hover:bg-base-600 data-[separator-active]:bg-base-500" />
          </>
        ) : (
          <div className="flex w-8 shrink-0 items-start justify-center border-r border-base-750 py-2">
            <button
              onClick={() => setIsLeftSidebarOpen(true)}
              className="ghost-button flex h-8 w-8 items-center justify-center rounded-sm"
              title="Open sidebar"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <Panel id="main-content" defaultSize="82%" minSize="35%">
          <Group orientation="horizontal" className="h-full">
            <Panel id="ai-chat" defaultSize="46%" minSize="28%" maxSize="68%">
              <AiChatPanel />
            </Panel>

            <Separator className="w-px bg-base-750 transition-colors-fast hover:bg-base-600 data-[separator-active]:bg-base-500" />

            <Panel id="workspace" defaultSize="54%" minSize="30%">
              {!hasAnyConnection && !hasOpenTabs ? (
                <NoConnectionState />
              ) : !hasOpenTabs ? (
                <NoSheetsState />
              ) : (
                <Group orientation="vertical" className="h-full">
                  <Panel
                    id="editor"
                    defaultSize={isResultTabActive || isResultsPanelMinimized ? "100%" : "65%"}
                    minSize="30%"
                  >
                    <div className="flex h-full flex-col overflow-hidden bg-surface">
                      <EditorToolbar />
                      <div className="flex-1 overflow-hidden">
                        {activeEditorTab?.kind === "result" ? <ResultTabEditor /> : <SqlEditor />}
                      </div>
                    </div>
                  </Panel>

                  {isResultTabActive ? null : isResultsPanelMinimized ? (
                    <div className="flex h-9 items-center justify-end border-t border-base-750 bg-base-900 px-3">
                      <button
                        onClick={toggleResultsPanelMinimized}
                        className="ghost-button flex items-center gap-1 rounded-sm px-2.5 py-1 text-[11px]"
                        title="Show results panel"
                      >
                        <PanelBottomOpen className="w-3.5 h-3.5" />
                        <span>Show Results</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <Separator className="h-px bg-base-750 transition-colors-fast hover:bg-base-600 data-[separator-active]:bg-base-500" />
                      <Panel id="results" defaultSize="35%" minSize="15%" maxSize="70%">
                        <ResultsPanel />
                      </Panel>
                    </>
                  )}
                </Group>
              )}
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
