import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { X, Table2 } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

  const sortable = useSortable({ id: `script:${script.id}` });
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

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
        ref={setNodeRef}
        style={sortableStyle}
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
      ref={setNodeRef}
      style={sortableStyle}
      data-tab-id={script.id}
      onClick={() => setActiveScript(script.id)}
      onDoubleClick={handleDoubleClick}
      onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeScript(script.id))}
      className={cn(
        "flex items-center gap-1.5 h-6 px-2 rounded-sm text-[12px] font-medium shrink-0 border cursor-grab active:cursor-grabbing",
        isActive
          ? "bg-base-850 border-base-700 text-base-100"
          : "border-transparent text-base-300 hover:text-base-100 hover:bg-base-850"
      )}
      {...attributes}
      {...listeners}
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
        onPointerDown={(e) => e.stopPropagation()}
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

  const sortable = useSortable({ id: `result:${tab.id}` });
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      style={sortableStyle}
      data-tab-id={tab.id}
      onClick={() => setActiveResultTab(tab.id)}
      onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeResultTab(tab.id))}
      className={cn(
        "flex items-center gap-1.5 h-6 px-2 rounded-sm text-[12px] font-medium shrink-0 border cursor-grab active:cursor-grabbing",
        isActive
          ? "bg-base-850 border-base-700 text-base-100"
          : "border-transparent text-base-300 hover:text-base-100 hover:bg-base-850"
      )}
      {...attributes}
      {...listeners}
    >
      <Table2 className="w-3.5 h-3.5 text-accent-400 shrink-0" />
      <span className="truncate max-w-[120px]">{tab.name}</span>
      <span
        role="button"
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
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

type SortableTab =
  | { kind: "script"; id: string }
  | { kind: "result"; id: string };

function parseSortableId(rawId: string): SortableTab | null {
  const [kind, id] = rawId.split(":", 2);
  if (!id) return null;
  if (kind === "script") return { kind: "script", id };
  if (kind === "result") return { kind: "result", id };
  return null;
}

export function EditorTabs() {
  const {
    openScripts,
    openResultTabs,
    activeEditorTab,
    editorTabOrder,
    connections,
    reorderEditorTabs,
  } = useAppStore(
    useShallow((state) => ({
      openScripts: state.openScripts,
      openResultTabs: state.openResultTabs,
      activeEditorTab: state.activeEditorTab,
      editorTabOrder: state.editorTabOrder,
      connections: state.connections,
      reorderEditorTabs: state.reorderEditorTabs,
    }))
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  const orderedTabs = useMemo(() => {
    const scriptIds = new Set(openScripts.map((s) => s.id));
    const resultIds = new Set(openResultTabs.map((t) => t.id));
    const normalized: SortableTab[] = [];
    const seen = new Set<string>();

    for (const tab of editorTabOrder) {
      const exists =
        tab.kind === "script" ? scriptIds.has(tab.id) : resultIds.has(tab.id);
      if (!exists) continue;
      const key = `${tab.kind}:${tab.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(tab);
    }

    for (const script of openScripts) {
      const key = `script:${script.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ kind: "script", id: script.id });
    }

    for (const tab of openResultTabs) {
      const key = `result:${tab.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ kind: "result", id: tab.id });
    }

    return normalized;
  }, [editorTabOrder, openScripts, openResultTabs]);

  const sortableIds = orderedTabs.map((tab) => `${tab.kind}:${tab.id}`);
  const scriptsById = useMemo(
    () => new Map(openScripts.map((script) => [script.id, script])),
    [openScripts]
  );
  const resultTabsById = useMemo(
    () => new Map(openResultTabs.map((tab) => [tab.id, tab])),
    [openResultTabs]
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeTab = parseSortableId(String(active.id));
    const overTab = parseSortableId(String(over.id));
    if (!activeTab || !overTab) return;

    reorderEditorTabs(activeTab, overTab);
  };

  if (openScripts.length === 0 && openResultTabs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center h-full min-w-0 flex-1 relative">
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-base-900 to-transparent z-10 pointer-events-none" />
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollContainerRef}
            onWheel={handleWheel}
            className="flex items-center gap-1 overflow-x-auto editor-tabs-scroll h-full w-fit"
          >
            {orderedTabs.map((tab) => {
              if (tab.kind === "script") {
                const script = scriptsById.get(tab.id);
                if (!script) return null;
                return (
                  <ScriptTab
                    key={`script:${script.id}`}
                    script={script}
                    isActive={activeEditorTab?.kind === "script" && activeEditorTab.id === script.id}
                    isConnected={isConnectionActive(script.connectionId)}
                  />
                );
              }
              const resultTab = resultTabsById.get(tab.id);
              if (!resultTab) return null;
              return (
                <ResultTab
                  key={`result:${resultTab.id}`}
                  tab={resultTab}
                  isActive={activeEditorTab?.kind === "result" && activeEditorTab.id === resultTab.id}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-base-900 to-transparent z-10 pointer-events-none" />
      )}
    </div>
  );
}
