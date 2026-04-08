import { useState, useMemo } from "react";
import {
  Plus,
  Plug,
  Unplug,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { ConnectionInfo } from "@/stores/types";

interface ConnectionRowProps {
  conn: ConnectionInfo;
  isActive: boolean;
  isConnecting: boolean;
  onConnect: (conn: ConnectionInfo) => void;
  onEdit: (conn: ConnectionInfo) => void;
  onDelete: (conn: ConnectionInfo) => void;
  onSelect: (conn: ConnectionInfo) => void;
  onRefresh: (id: string) => void;
}

function ConnectionRow({
  conn,
  isActive,
  isConnecting,
  onConnect,
  onEdit,
  onDelete,
  onSelect,
  onRefresh,
}: ConnectionRowProps) {
  return (
    <div
      className={cn(
        "mx-3 flex items-center gap-2 px-2.5 py-1.5 transition-colors-fast",
        isActive ? "bg-base-850/55" : "hover:bg-base-850/35"
      )}
    >
      {/* Name and host with status dot */}
      <button
        onClick={() => conn.is_connected && onSelect(conn)}
        className="flex-1 min-w-0 text-left cursor-pointer font-mono"
      >
        <div className="flex items-center gap-2">
          {isConnecting ? (
            <Loader2 className="w-3 h-3 animate-spin text-accent-500 flex-shrink-0" />
          ) : (
            <div
              className={cn(
                "w-2 h-2 rounded-full flex-shrink-0",
                conn.is_connected ? "bg-emerald-500" : "bg-base-600"
              )}
            />
          )}
          <span
            className={cn(
              "truncate text-[13px] font-semibold leading-5",
              isActive ? "text-base-100" : "text-base-200"
            )}
          >
            {conn.name}
          </span>
        </div>
        <div className="ml-4 mt-0.5 truncate text-[12px] leading-5 text-base-300">
          {conn.host}:{conn.port}
        </div>
      </button>

      {/* Actions - always visible */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={() => onConnect(conn)}
          disabled={isConnecting}
          className={cn(
            "p-1 text-base-300 hover:text-base-100 hover:bg-base-800 cursor-pointer transition-colors-fast",
            isConnecting && "opacity-50 cursor-not-allowed"
          )}
          title={isConnecting ? "Connecting..." : conn.is_connected ? "Disconnect" : "Connect"}
        >
          {isConnecting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : conn.is_connected ? (
            <Unplug className="w-3.5 h-3.5" />
          ) : (
            <Plug className="w-3.5 h-3.5" />
          )}
        </button>
        {conn.is_connected && (
          <button
            onClick={() => onRefresh(conn.id)}
            className="p-1 text-base-300 hover:text-base-100 hover:bg-base-800 cursor-pointer transition-colors-fast"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onEdit(conn)}
          className="p-1 text-base-300 hover:text-base-100 hover:bg-base-800 cursor-pointer transition-colors-fast"
          title="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(conn)}
          className="p-1 text-base-300 hover:text-red-300 hover:bg-base-800 cursor-pointer transition-colors-fast"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

interface ConnectionsListProps {
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

export function ConnectionsList({ isExpanded, onToggleExpanded }: ConnectionsListProps) {
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

  const [searchQuery, setSearchQuery] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);

  // Count connected databases
  const connectedCount = useMemo(
    () => connections.filter((c) => c.is_connected).length,
    [connections]
  );

  // Filter connections based on search query
  const filteredConnections = useMemo(() => {
    if (!searchQuery.trim()) return connections;
    const query = searchQuery.toLowerCase();
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.host?.toLowerCase().includes(query) ||
        c.database.toLowerCase().includes(query)
    );
  }, [connections, searchQuery]);

  // Show search when 5+ connections
  const showSearch = connections.length >= 5;

  const handleConnect = async (conn: ConnectionInfo) => {
    if (connectingId) return; // Prevent multiple simultaneous connections
    
    try {
      if (conn.is_connected) {
        await disconnect(conn.id);
        showToast("info", `Disconnected from ${conn.name}`);
      } else {
        setConnectingId(conn.id);
        showToast("info", `Connecting to ${conn.name}...`);
        await connect(conn.id);
        showToast("success", `Connected to ${conn.name}`);
      }
    } catch (error) {
      showToast("error", String(error));
    } finally {
      setConnectingId(null);
    }
  };

  const handleDelete = async (conn: ConnectionInfo) => {
    if (confirm(`Delete connection "${conn.name}"?`)) {
      await deleteConnection(conn.id);
    }
  };

  const handleSelect = (conn: ConnectionInfo) => {
    if (conn.is_connected) {
      setActiveConnection(conn.id);
    }
  };

  return (
    <div className="border-b border-base-750/60 bg-base-900/70">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={onToggleExpanded}
          className="flex flex-1 items-center gap-1.5 px-1 py-0.5 text-left transition-colors-fast hover:bg-base-850/60 cursor-pointer"
          title={isExpanded ? "Collapse connections" : "Expand connections"}
        >
          <ChevronRight
            className={cn(
              "w-3 h-3 text-base-300 transition-transform duration-150",
              isExpanded && "rotate-90"
            )}
          />
          <span className="text-[11px] font-semibold text-base-100 uppercase tracking-[0.14em]">
            Connections
          </span>
          {connections.length > 0 && (
            <span className="ml-0.5 text-[12px] text-base-200">
              [{connectedCount > 0 ? `${connectedCount} ONLINE` : connections.length}]
            </span>
          )}
        </button>
        <button
          onClick={() => openConnectionDialog()}
          className="ghost-button -mr-1 rounded-sm p-1 transition-colors-fast cursor-pointer"
          aria-label="Add connection"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded: Show search + all connections */}
      {isExpanded && (
        <div className="max-h-[38vh] overflow-y-auto pb-3 connections-scroll">
          {isLoadingConnections ? (
            <div className="px-3 py-3 flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-base-300" />
            </div>
          ) : connections.length === 0 ? (
            <div className="px-3 py-3 text-center font-mono">
              <p className="mb-2 text-[13px] text-base-200">NO CONNECTIONS</p>
              <button
                onClick={() => openConnectionDialog()}
                className="text-[12px] text-accent-500 hover:text-accent-400 cursor-pointer transition-colors-fast"
              >
                + ADD ONE
              </button>
            </div>
          ) : (
            <>
              {/* Search input - only shown when 5+ connections */}
              {showSearch && (
                <div className="mx-3 mb-3">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-base-300" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search connections..."
                      className="w-full border-b border-base-700 bg-base-850/70 py-1.5 pl-7 pr-7 text-[12px] text-base-100 placeholder:text-base-400 transition-colors-fast focus:border-accent-500/60 focus:outline-none"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-base-300 hover:text-base-100 cursor-pointer transition-colors-fast"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Connection list */}
              {filteredConnections.length === 0 ? (
                <div className="px-3 py-3 text-center">
                  <p className="text-[12px] text-base-200 font-mono">NO MATCHES FOUND</p>
                </div>
              ) : (
                filteredConnections.map((conn) => (
                  <ConnectionRow
                    key={conn.id}
                    conn={conn}
                    isActive={activeConnectionId === conn.id}
                    isConnecting={connectingId === conn.id}
                    onConnect={handleConnect}
                    onEdit={openConnectionDialog}
                    onDelete={handleDelete}
                    onSelect={handleSelect}
                    onRefresh={refreshConnectionMetadata}
                  />
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
