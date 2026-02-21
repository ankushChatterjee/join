import { useRef, useState, useEffect, useCallback } from "react";
import { X, Plus } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { cn } from "@/lib/utils";

interface ScriptTabProps {
  script: {
    id: string;
    name: string;
    connectionId: string;
    isDirty: boolean;
  };
  isActive: boolean;
  isConnected: boolean;
}

function ScriptTab({ script, isActive, isConnected }: ScriptTabProps) {
  const { setActiveScript, closeScript, renameScript } = useAppStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(script.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(script.name);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    const trimmedName = editName.trim();
    if (trimmedName && trimmedName !== script.name) {
      await renameScript(script.id, trimmedName);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      setEditName(script.name);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 h-6 px-1.5 rounded-sm shrink-0 border",
          isActive ? "bg-base-850 border-base-700" : "bg-base-900 border-base-800"
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="w-24 bg-base-800 border border-accent-500 rounded-sm px-1.5 py-0.5 text-[12px] text-base-100 outline-none"
        />
      </div>
    );
  }

  return (
    <button
      data-script-id={script.id}
      onClick={() => setActiveScript(script.id)}
      onDoubleClick={handleDoubleClick}
      onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeScript(script.id))}
      className={cn(
        "group flex items-center gap-1.5 h-6 px-2 rounded-sm text-[12px] font-medium transition-colors-fast shrink-0 border",
        isActive
          ? "bg-base-850 border-base-700 text-base-100"
          : "border-transparent text-base-300 hover:text-base-100 hover:bg-base-850"
      )}
    >
      {/* Disconnected indicator */}
      {!isConnected && (
        <span 
          className="w-1.5 h-1.5 rounded-full bg-error shrink-0" 
          title="Connection not active"
        />
      )}

      {/* Name */}
      <span className="truncate max-w-[96px]">{script.name}</span>

      {/* Close */}
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          closeScript(script.id);
        }}
        className="p-0.5 -mr-1 rounded-sm hover:bg-base-700 text-base-300 hover:text-base-100"
      >
        <X className="w-3 h-3" />
      </span>
    </button>
  );
}

export function EditorTabs() {
  const {
    openScripts,
    activeScriptId,
    connections,
    createScript,
    activeConnectionId,
  } = useAppStore();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      ro.disconnect();
    };
  }, [checkScroll, openScripts.length]);

  useEffect(() => {
    if (!activeScriptId || !scrollContainerRef.current) return;
    const tab = scrollContainerRef.current.querySelector(`[data-script-id="${activeScriptId}"]`);
    tab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeScriptId]);

  const handleNewScript = async () => {
    if (activeConnectionId) {
      await createScript(activeConnectionId);
    }
  };

  // Check if a script's connection is active
  const isConnectionActive = (connectionId: string) => {
    const conn = connections.find((c) => c.id === connectionId);
    return conn?.is_connected ?? false;
  };

  // Don't render if no scripts
  if (openScripts.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center h-full min-w-0 flex-1 relative">
      {/* Left fade */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-base-900 to-transparent z-10 pointer-events-none" />
      )}

      {/* SQL sheets */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-1 overflow-x-auto editor-tabs-scroll h-full"
      >
        {openScripts.map((script) => (
          <ScriptTab
            key={script.id}
            script={script}
            isActive={script.id === activeScriptId}
            isConnected={isConnectionActive(script.connectionId)}
          />
        ))}
      </div>

      {/* Right fade */}
      {canScrollRight && (
        <div className="absolute right-7 top-0 bottom-0 w-4 bg-gradient-to-l from-base-900 to-transparent z-10 pointer-events-none" />
      )}

      {/* New SQL sheet - only show when there's an active connection */}
      {activeConnectionId && (
        <button
          onClick={handleNewScript}
          className="ml-0.5 p-1 rounded-sm text-base-300 hover:text-base-100 hover:bg-base-800 transition-colors-fast shrink-0"
          title="New SQL sheet"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}
