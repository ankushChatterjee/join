// ============================================================================
// Cell Pill Component - Clickable cell reference in chat messages
// ============================================================================

import { LayoutGrid } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

interface CellPillProps {
  cellIndex: number;
  cellId: string;
  scriptId: string;
}

export function CellPill({ cellIndex, cellId, scriptId }: CellPillProps) {
  const handleClick = (e: React.MouseEvent) => {
    // Prevent any default behavior (important for Tauri)
    e.preventDefault();
    e.stopPropagation();

    const state = useAppStore.getState();

    // First, try to find the script directly
    let script = state.openScripts.find((s) => s.id === scriptId);
    let targetScriptId = scriptId;

    // If script not found, search for the cell across all open scripts
    if (!script) {
      for (const s of state.openScripts) {
        if (s.cells.some((c) => c.id === cellId)) {
          script = s;
          targetScriptId = s.id;
          break;
        }
      }
    }

    if (!script) {
      console.log("[CellPill] Cell not found in any open script:", cellId);
      return;
    }

    // Verify the cell exists in the script
    const cellExists = script.cells.some((c) => c.id === cellId);
    if (!cellExists) {
      console.log("[CellPill] Cell not found in script:", { cellId, scriptId: targetScriptId });
      return;
    }

    // Switch to the script if it's not already active
    if (state.activeScriptId !== targetScriptId) {
      state.setActiveScript(targetScriptId);
    }

    // Select the cell
    state.setSelectedScriptCell(targetScriptId, cellId);

    // Scroll to the cell element (use setTimeout to ensure DOM is ready after script switch)
    setTimeout(() => {
      const cellElement = document.getElementById(`cell-${cellId}`);
      if (cellElement) {
        cellElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium bg-accent-500/15 text-accent-300 hover:bg-accent-500/25 cursor-pointer transition-colors-fast border-0 outline-none"
      title={`Go to Cell ${cellIndex}`}
    >
      <LayoutGrid className="w-3 h-3" />
      <span>Cell {cellIndex}</span>
    </button>
  );
}
