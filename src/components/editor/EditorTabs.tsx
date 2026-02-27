import { useRef, useState, useEffect, useCallback } from "react";
import { X, Table2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";

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
  const { setActiveScript, closeScript, renameScript } = useAppStore(
    useShallow((state) => ({
      setActiveScript: state.setActiveScript,
      closeScript: state.closeScript,
      renameScript: state.renameScript,
    }))
  );
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
      data-tab-id={script.id}
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
      {!isConnected && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-error shrink-0"
          title="Connection not active"
        />
      )}

      <span className="truncate max-w-[96px]">{script.name}</span>
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

interface ResultTabProps {
  tab: {
    id: string;
    name: string;
  };
  isActive: boolean;
}

function ResultTab({ tab, isActive }: ResultTabProps) {
  const { setActiveResultTab, closeResultTab } = useAppStore(
    useShallow((state) => ({
      setActiveResultTab: state.setActiveResultTab,
      closeResultTab: state.closeResultTab,
    }))
  );

  return (
    <button
      data-tab-id={tab.id}
      onClick={() => setActiveResultTab(tab.id)}
      onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeResultTab(tab.id))}
      className={cn(
        "group flex items-center gap-1.5 h-6 px-2 rounded-sm text-[12px] font-medium transition-colors-fast shrink-0 border",
        isActive
          ? "bg-base-850 border-base-700 text-base-100"
          : "border-transparent text-base-300 hover:text-base-100 hover:bg-base-850"
      )}
    >
      <Table2 className="w-3.5 h-3.5 text-accent-400 shrink-0" />
      <span className="truncate max-w-[120px]">{tab.name}</span>
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          closeResultTab(tab.id);
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
    openResultTabs,
    activeEditorTab,
    connections,
  } = useAppStore(
    useShallow((state) => ({
      openScripts: state.openScripts,
      openResultTabs: state.openResultTabs,
      activeEditorTab: state.activeEditorTab,
      connections: state.connections,
    }))
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (e.deltaY !== 0) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
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
  }, [checkScroll, openScripts.length, openResultTabs.length]);

  useEffect(() => {
    if (!activeEditorTab || !scrollContainerRef.current) return;
    const tab = scrollContainerRef.current.querySelector(`[data-tab-id="${activeEditorTab.id}"]`);
    tab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeEditorTab]);

  const isConnectionActive = (connectionId: string) => {
    const conn = connections.find((c) => c.id === connectionId);
    return conn?.is_connected ?? false;
  };

  if (openScripts.length === 0 && openResultTabs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center h-full min-w-0 flex-1 relative">
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-base-900 to-transparent z-10 pointer-events-none" />
      )}

      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex items-center gap-1 overflow-x-auto editor-tabs-scroll h-full w-fit"
      >
        {openScripts.map((script) => (
          <ScriptTab
            key={script.id}
            script={script}
            isActive={activeEditorTab?.kind === "script" && activeEditorTab.id === script.id}
            isConnected={isConnectionActive(script.connectionId)}
          />
        ))}
        {openResultTabs.map((resultTab) => (
          <ResultTab
            key={resultTab.id}
            tab={resultTab}
            isActive={activeEditorTab?.kind === "result" && activeEditorTab.id === resultTab.id}
          />
        ))}
      </div>

      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-base-900 to-transparent z-10 pointer-events-none" />
      )}
    </div>
  );
}
