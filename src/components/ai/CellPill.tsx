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

    let targetScriptId: string | null = null;
    let targetCellId: string | null = null;

    // Primary resolution: exact script + exact cell id from the link payload.
    const linkedScript = state.openScripts.find((s) => s.id === scriptId);
    if (linkedScript) {
      const linkedCell = linkedScript.cells.find((c) => c.id === cellId);
      if (linkedCell) {
        targetScriptId = linkedScript.id;
        targetCellId = linkedCell.id;
      } else if (cellIndex > 0 && cellIndex <= linkedScript.cells.length) {
        // Recovery path: link has a stale/incorrect cell id, but label "Cell N" is usable.
        targetScriptId = linkedScript.id;
        targetCellId = linkedScript.cells[cellIndex - 1].id;
      }
    }

    // Secondary resolution: find an exact cell id in any open script.
    if (!targetScriptId || !targetCellId) {
      for (const s of state.openScripts) {
        const foundCell = s.cells.find((c) => c.id === cellId);
        if (foundCell) {
          targetScriptId = s.id;
          targetCellId = foundCell.id;
          break;
        }
      }
    }

    // Final fallback: use the cell index in any open script.
    if ((!targetScriptId || !targetCellId) && cellIndex > 0) {
      for (const s of state.openScripts) {
        if (cellIndex <= s.cells.length) {
          targetScriptId = s.id;
          targetCellId = s.cells[cellIndex - 1].id;
          break;
        }
      }
    }

    if (!targetScriptId || !targetCellId) {
      console.log("[CellPill] Failed to resolve linked cell:", { cellIndex, cellId, scriptId });
      return;
    }

    // Switch to the script if it's not already active
    if (state.activeScriptId !== targetScriptId) {
      state.setActiveScript(targetScriptId);
    }

    // Select the cell
    state.setSelectedScriptCell(targetScriptId, targetCellId);

    // Scroll to the cell element (use setTimeout to ensure DOM is ready after script switch)
    setTimeout(() => {
      const cellElement = document.getElementById(`cell-${targetCellId}`);
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
