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
  PanelLeftClose,
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
        "flex items-center gap-1.5 mx-1 px-1.5 py-1 rounded-sm transition-colors-fast border border-transparent",
        isActive ? "bg-base-850 border-base-700/80" : "hover:bg-base-850/70"
      )}
    >
      {/* Name and host with status dot */}
      <button
        onClick={() => conn.is_connected && onSelect(conn)}
        className="flex-1 min-w-0 text-left cursor-pointer"
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
              "text-[13px] truncate",
              isActive ? "text-base-100" : "text-base-200"
            )}
          >
            {conn.name}
          </span>
        </div>
        <div className="text-[12px] text-base-300 truncate ml-3.5">
          {conn.host}:{conn.port}
        </div>
      </button>

      {/* Actions - always visible */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={() => onConnect(conn)}
          disabled={isConnecting}
          className={cn(
            "p-1 rounded-sm text-base-300 hover:text-base-100 hover:bg-base-800 cursor-pointer transition-colors-fast",
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
            className="p-1 rounded-sm text-base-300 hover:text-base-100 hover:bg-base-800 cursor-pointer transition-colors-fast"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onEdit(conn)}
          className="p-1 rounded-sm text-base-300 hover:text-base-100 hover:bg-base-800 cursor-pointer transition-colors-fast"
          title="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(conn)}
          className="p-1 rounded-sm text-base-300 hover:text-red-300 hover:bg-base-800 cursor-pointer transition-colors-fast"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

interface ConnectionsListProps {
  onCollapseSidebar?: () => void;
}

export function ConnectionsList({ onCollapseSidebar }: ConnectionsListProps) {
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

  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);

  // Count connected databases
  const connectedCount = useMemo(
    () => connections.filter((c) => c.is_connected).length,
    [connections]
  );

  // Find active connection
  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId),
    [connections, activeConnectionId]
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
    <div className="border-b border-base-750">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-base-850 transition-colors-fast cursor-pointer"
      >
        <div className="flex items-center gap-1.5">
          {onCollapseSidebar && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onCollapseSidebar();
              }}
              className="w-5 h-5 rounded-sm flex items-center justify-center text-base-300 hover:text-base-100 hover:bg-base-800 transition-colors-fast mr-0.5"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronRight
            className={cn(
              "w-3 h-3 text-base-300 transition-transform duration-150",
              isExpanded && "rotate-90"
            )}
          />
          <span className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.08em]">
            Connections
          </span>
          {connections.length > 0 && (
            <span className="text-[11px] text-base-300 ml-0.5">
              ({connectedCount > 0 ? `${connectedCount} connected` : connections.length})
            </span>
          )}
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            openConnectionDialog();
          }}
          className="p-1 -mr-1 rounded-sm text-base-300 hover:text-base-100 hover:bg-base-800 transition-colors-fast"
          role="button"
          aria-label="Add connection"
        >
          <Plus className="w-3.5 h-3.5" />
        </div>
      </button>

      {/* Collapsed: Show only active connection */}
      {!isExpanded && activeConnection && (
        <div className="pb-1">
          <ConnectionRow
            conn={activeConnection}
            isActive={true}
            isConnecting={connectingId === activeConnection.id}
            onConnect={handleConnect}
            onEdit={openConnectionDialog}
            onDelete={handleDelete}
            onSelect={handleSelect}
            onRefresh={refreshConnectionMetadata}
          />
        </div>
      )}

      {/* Expanded: Show search + all connections */}
      {isExpanded && (
        <div className="pb-1 max-h-[38vh] overflow-y-auto connections-scroll">
          {isLoadingConnections ? (
            <div className="px-3 py-3 flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-base-300" />
            </div>
          ) : connections.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <p className="text-[12px] text-base-200 mb-2">No connections</p>
              <button
                onClick={() => openConnectionDialog()}
                className="text-[12px] text-accent-500 hover:text-accent-400 cursor-pointer transition-colors-fast"
              >
                + Add one
              </button>
            </div>
          ) : (
            <>
              {/* Search input - only shown when 5+ connections */}
              {showSearch && (
                <div className="mx-1 mb-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-base-300" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search connections..."
                      className="w-full pl-7 pr-7 py-1.5 text-[12px] bg-base-850 border border-base-700 rounded-sm text-base-100 placeholder:text-base-400 focus:outline-none focus:border-accent-500/60 transition-colors-fast"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-base-300 hover:text-base-100 cursor-pointer transition-colors-fast"
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
                  <p className="text-[12px] text-base-200">No matches found</p>
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
