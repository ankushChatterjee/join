import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Clock, X, Trash2, AlertCircle, Check } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { insertTextAtCursor } from "@/components/editor/editorUtils";
import { cn } from "@/lib/utils";
import type { QueryHistoryEntry } from "@/stores/types";
import { useShallow } from "zustand/react/shallow";

// Format timestamp as relative time
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// Truncate SQL for display
function truncateSql(sql: string, maxLength: number = 80): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength) + "…";
}

// Query History Dropdown Component for TitleBar
function QueryHistoryDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const { queryHistory, clearQueryHistory } = useAppStore(
    useShallow((state) => ({
      queryHistory: state.queryHistory,
      clearQueryHistory: state.clearQueryHistory,
    }))
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 0 });

  // Calculate position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    
    // Use setTimeout to avoid immediate close from the same click that opened
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const handleSelectQuery = useCallback((entry: QueryHistoryEntry) => {
    insertTextAtCursor(entry.sql);
    setIsOpen(false);
  }, []);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    clearQueryHistory();
  }, [clearQueryHistory]);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={cn(
          "ghost-button relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm",
          isOpen
            ? "bg-base-800/90 text-accent-400"
            : "text-base-300"
        )}
        title="Query history"
      >
        <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>

      {isOpen && createPortal(
        <div 
          ref={dropdownRef}
          className="panel-shell fixed z-[100] max-h-[400px] w-[390px] overflow-hidden"
          style={{ top: dropdownPosition.top, right: dropdownPosition.right }}
        >
          <div className="flex items-center justify-between border-b border-base-700/40 px-3 py-2">
            <span className="text-xs font-semibold text-base-200 tracking-[0.03em]">Query history</span>
            <div className="flex items-center gap-1">
              {queryHistory.length > 0 && (
                <button
                  onClick={handleClear}
                  className="ghost-button p-1"
                  title="Clear history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleClose}
                className="ghost-button p-1"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* History list */}
          <div className="overflow-auto panel-scroll max-h-[340px]">
            {queryHistory.length === 0 ? (
              <div className="px-3 py-7 text-center text-base-300 text-xs">
                No queries executed yet
              </div>
            ) : (
              queryHistory.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleSelectQuery(entry)}
                  className="w-full border-b border-base-700/20 px-3 py-2 text-left transition-colors-fast hover:bg-white/[0.03] last:border-b-0"
                >
                  <div className="flex items-start gap-1.5">
                    {/* Status indicator */}
                    <div className="shrink-0 mt-0.5">
                      {entry.error ? (
                        <AlertCircle className="w-3 h-3 text-red-400" />
                      ) : (
                        <Check className="w-3 h-3 text-green-400" />
                      )}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-mono text-base-200 truncate">
                        {truncateSql(entry.sql)}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-base-300">
                        <span>{entry.connectionName}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(entry.timestamp)}</span>
                        {entry.rowCount !== null && (
                          <>
                            <span>•</span>
                            <span>{entry.rowCount} rows</span>
                          </>
                        )}
                        {entry.executionTimeMs !== null && (
                          <>
                            <span>•</span>
                            <span>{entry.executionTimeMs}ms</span>
                          </>
                        )}
                      </div>
                      {entry.error && (
                        <p className="text-[11px] text-red-300 truncate mt-0.5">
                          {entry.error}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export function TitleBar() {
  const projectName = useAppStore((state) => state.activeProject?.name ?? null);
  return (
    <header 
      className="title-bar relative grid h-[38px] shrink-0 grid-cols-[88px_1fr_88px] items-center border-b border-base-750 bg-base-900 px-2 select-none"
      data-tauri-drag-region
    >
      <div className="h-full" />

      <div className="flex items-center justify-center pointer-events-none px-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-100">Join</span>
          {projectName ? <span className="text-[12px] text-base-300">/ {projectName}</span> : null}
        </div>
      </div>

      <div className="relative z-10 flex h-full items-center justify-end gap-1 px-1">
        <QueryHistoryDropdown />
      </div>
    </header>
  );
}
