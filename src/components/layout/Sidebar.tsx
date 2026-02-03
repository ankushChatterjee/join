import { ConnectionsList } from "@/components/connections/ConnectionsList";
import { SchemaTree } from "@/components/connections/SchemaTree";

export function Sidebar() {
  return (
    <div className="h-full flex flex-col bg-base-900">
      {/* Connections section */}
      <ConnectionsList />
      
      {/* Schema tree - takes remaining space */}
      <div className="flex-1 overflow-hidden">
        <SchemaTree />
      </div>
    </div>
  );
}
