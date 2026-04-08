import { ConnectionsList } from "@/components/connections/ConnectionsList";
import { SchemaTree } from "@/components/connections/SchemaTree";
import { LogOut, PanelLeftClose } from "lucide-react";
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
    <div className="flex h-full flex-col overflow-hidden bg-base-900">
      {activeProject ? (
        <div className="border-b border-base-750 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onCollapse}
              className="ghost-button flex h-8 w-8 items-center justify-center rounded-sm"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-base-50">
                {activeProject.name}
              </div>
              <div className="mt-1 truncate text-[11px] text-base-300">
                {activeProject.rootPath}
              </div>
            </div>
            <button
              onClick={closeProject}
              className="ghost-button p-2"
              title="Close project"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
      <ConnectionsList
        isExpanded={isConnectionsExpanded}
        onToggleExpanded={() => setIsConnectionsExpanded((value) => !value)}
      />
      
      {isConnectionsExpanded ? (
        <div className="flex-1 overflow-hidden border-t border-base-700/20">
          <SchemaTree />
        </div>
      ) : null}
    </div>
  );
}
