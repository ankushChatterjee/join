import {
  Database,
  Plus,
  Plug,
  Unplug,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { ConnectionInfo } from "@/stores/types";

export function ConnectionsList() {
  const {
    connections,
    activeConnectionId,
    isLoadingConnections,
    connect,
    disconnect,
    setActiveConnection,
    openConnectionDialog,
    deleteConnection,
    showToast,
    refreshConnectionMetadata,
  } = useAppStore();

  const handleConnect = async (conn: ConnectionInfo) => {
    try {
      if (conn.is_connected) {
        await disconnect(conn.id);
        showToast("info", `Disconnected from ${conn.name}`);
      } else {
        await connect(conn.id);
        showToast("success", `Connected to ${conn.name}`);
      }
    } catch (error) {
      showToast("error", String(error));
    }
  };

  const handleDelete = async (conn: ConnectionInfo) => {
    if (confirm(`Delete connection "${conn.name}"?`)) {
      await deleteConnection(conn.id);
    }
  };

  return (
    <div className="border-b border-base-800">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-base-300 uppercase tracking-wide">
          Connections
        </span>
        <button
          onClick={() => openConnectionDialog()}
          className="p-1 -mr-1 rounded text-base-400 hover:text-base-200 hover:bg-base-800 transition-colors cursor-pointer"
          aria-label="Add connection"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* List */}
      <div className="pb-1.5">
        {isLoadingConnections ? (
          <div className="px-3 py-4 flex justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-base-500" />
          </div>
        ) : connections.length === 0 ? (
          <div className="px-3 py-3 text-center">
            <p className="text-[12px] text-base-500 mb-2">No connections</p>
            <button
              onClick={() => openConnectionDialog()}
              className="text-[12px] text-accent-500 hover:text-accent-400 cursor-pointer"
            >
              + Add one
            </button>
          </div>
        ) : (
          connections.map((conn) => (
            <div
              key={conn.id}
              className={cn(
                "flex items-center gap-2 mx-1.5 px-2 py-1.5 rounded-md transition-colors",
                activeConnectionId === conn.id
                  ? "bg-base-800"
                  : "hover:bg-base-800/50"
              )}
            >
              {/* Name and host with status dot */}
              <button
                onClick={() => conn.is_connected && setActiveConnection(conn.id)}
                className="flex-1 min-w-0 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      conn.is_connected ? "bg-emerald-500" : "bg-base-600"
                    )}
                  />
                  <span
                    className={cn(
                      "text-[13px] truncate",
                      activeConnectionId === conn.id
                        ? "text-base-100"
                        : "text-base-200"
                    )}
                  >
                    {conn.name}
                  </span>
                </div>
                <div className="text-[11px] text-base-400 truncate ml-4">
                  {conn.host}:{conn.port}
                </div>
              </button>

              {/* Actions - always visible */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => handleConnect(conn)}
                  className="p-1 rounded text-base-400 hover:text-base-100 hover:bg-base-700 cursor-pointer"
                  title={conn.is_connected ? "Disconnect" : "Connect"}
                >
                  {conn.is_connected ? (
                    <Unplug className="w-3 h-3" />
                  ) : (
                    <Plug className="w-3 h-3" />
                  )}
                </button>
                {conn.is_connected && (
                  <button
                    onClick={() => refreshConnectionMetadata(conn.id)}
                    className="p-1 rounded text-base-400 hover:text-base-100 hover:bg-base-700 cursor-pointer"
                    title="Refresh"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => openConnectionDialog(conn)}
                  className="p-1 rounded text-base-400 hover:text-base-100 hover:bg-base-700 cursor-pointer"
                  title="Edit"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleDelete(conn)}
                  className="p-1 rounded text-base-400 hover:text-red-400 hover:bg-base-700 cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
