// ============================================================================
// Cell Link Parser - Convert "Cell N" references to markdown links
// ============================================================================

import type { SqlSheetCell } from "@/stores/types";

/**
 * Parse content for cell references (e.g., "Cell 1", "Cell 2") and convert them
 * to markdown links that will render as CellPill components.
 *
 * Only references to existing cells in the provided cells array are converted.
 * Invalid references (e.g., "Cell 99" when only 5 cells exist) are left as plain text.
 *
 * This is a FALLBACK mechanism when the AI hasn't already generated proper cell links.
 * The AI should ideally generate links in the format: [Cell N](cell://{scriptId}:{cellId})
 *
 * @param content - The markdown content to parse
 * @param cells - Array of cells in the active script (used to validate references)
 * @param scriptId - The ID of the current script/sheet
 * @returns Processed content with valid cell references converted to links
 */
export function parseCellReferences(
  content: string,
  cells: SqlSheetCell[],
  scriptId: string
): string {
  if (!cells.length || !scriptId) return content;

  // First, temporarily replace existing cell:// links to protect them
  const linkPlaceholders: string[] = [];
  let protectedContent = content.replace(
    /\[Cell\s+\d+\]\(cell:\/\/[^)]+\)/gi,
    (match) => {
      linkPlaceholders.push(match);
      return `__CELL_LINK_PLACEHOLDER_${linkPlaceholders.length - 1}__`;
    }
  );

  // Now replace "Cell N" references that aren't already links
  const cellRefRegex = /\bCell\s+(\d+)\b/gi;
  protectedContent = protectedContent.replace(cellRefRegex, (match, indexStr) => {
    const cellIndex = parseInt(indexStr, 10);
    const cellArrayIndex = cellIndex - 1;

    if (cellArrayIndex < 0 || cellArrayIndex >= cells.length) {
      return match;
    }

    const cell = cells[cellArrayIndex];
    return `[${match}](cell://${scriptId}:${cell.id})`;
  });

  // Restore protected links
  linkPlaceholders.forEach((placeholder, index) => {
    protectedContent = protectedContent.replace(
      `__CELL_LINK_PLACEHOLDER_${index}__`,
      placeholder
    );
  });

  return protectedContent;
}

/**
 * Extract the cell index from the children of a markdown link.
 * Used by the CellPill component to determine which cell number to display.
 *
 * @param children - React children from the markdown link
 * @returns The cell index number, or 0 if not found
 */
export function extractCellIndex(children: React.ReactNode): number {
  if (typeof children === "string") {
    const match = children.match(/Cell\s+(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return 0;
}
