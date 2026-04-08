import { ConnectionsList } from "@/components/connections/ConnectionsList";
import { SchemaTree } from "@/components/connections/SchemaTree";
import { FolderTree, LogOut, PanelLeftClose } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

interface SidebarProps {
  onCollapse: () => void;
}

export function Sidebar({ onCollapse }: SidebarProps) {
  const [isConnectionsExpanded, setIsConnectionsExpanded] = useState(true);
  const { activeProject, closeProject } = useAppStore(
    useShallow((state) => ({
      activeProject: state.activeProject,
      closeProject: state.closeProject,
    }))
  );

  return (
    <div className="h-full flex flex-col bg-base-900/95">
      {activeProject ? (
        <div className="border-b border-base-750 bg-base-900/88 px-2.5 py-2">
          <div className="mb-2 flex items-center justify-between">
            <button
              onClick={onCollapse}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-base-300 transition-colors-fast hover:bg-base-800 hover:text-base-100"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={closeProject}
              className="rounded-sm border border-base-700 p-1 text-base-300 transition-colors-fast hover:bg-base-800 hover:text-base-100"
              title="Close project"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-base-100">
                {activeProject.name}
              </div>
              <div className="truncate text-[11px] text-base-300">
                {activeProject.rootPath}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {/* Connections section */}
      <ConnectionsList
        isExpanded={isConnectionsExpanded}
        onToggleExpanded={() => setIsConnectionsExpanded((value) => !value)}
      />
      
      {/* Schema tree - takes remaining space */}
      {isConnectionsExpanded ? (
        <div className="flex-1 overflow-hidden border-t border-base-800/80">
          <SchemaTree />
        </div>
      ) : null}
    </div>
  );
}
