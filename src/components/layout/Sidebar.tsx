import { ConnectionsList } from "@/components/connections/ConnectionsList";
import { SchemaTree } from "@/components/connections/SchemaTree";

interface SidebarProps {
  onCollapse: () => void;
}

export function Sidebar({ onCollapse }: SidebarProps) {
  return (
    <div className="h-full flex flex-col bg-base-900/95">
      {/* Connections section */}
      <ConnectionsList onCollapseSidebar={onCollapse} />
      
      {/* Schema tree - takes remaining space */}
      <div className="flex-1 overflow-hidden border-t border-base-800/80">
        <SchemaTree />
      </div>
    </div>
  );
}
