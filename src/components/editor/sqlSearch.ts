import type { SqlSheetCell } from "@/stores/types";

export interface SheetSearchableCell {
  cellId: string;
  cellIndex: number;
  textLower: string;
}

export interface SheetSearchMatch {
  cellId: string;
  cellIndex: number;
  from: number;
  to: number;
}

export interface SearchHighlightRange {
  from: number;
  to: number;
  isActive: boolean;
}

export function buildSearchableCells(cells: SqlSheetCell[] | undefined, isSearchOpen: boolean): SheetSearchableCell[] {
  if (!isSearchOpen || !cells) return [];
  return cells.map((cell, cellIndex) => ({
    cellId: cell.id,
    cellIndex,
    textLower: cell.sql.toLowerCase(),
  }));
}

export function findSheetMatches(
  searchableCells: SheetSearchableCell[],
  rawQuery: string,
  maxMatches = 5000
): SheetSearchMatch[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query || searchableCells.length === 0) return [];

  const matches: SheetSearchMatch[] = [];
  for (const cell of searchableCells) {
    let fromIndex = 0;
    while (fromIndex < cell.textLower.length) {
      const matchFrom = cell.textLower.indexOf(query, fromIndex);
      if (matchFrom === -1) break;

      matches.push({
        cellId: cell.cellId,
        cellIndex: cell.cellIndex,
        from: matchFrom,
        to: matchFrom + query.length,
      });
      if (matches.length >= maxMatches) return matches;
      fromIndex = matchFrom + query.length;
    }
  }
  return matches;
}

export function buildHighlightRangesByCell(
  matches: SheetSearchMatch[],
  activeMatchIndex: number
): Record<string, SearchHighlightRange[]> {
  const ranges: Record<string, SearchHighlightRange[]> = {};
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const list = ranges[match.cellId] ?? [];
    list.push({
      from: match.from,
      to: match.to,
      isActive: i === activeMatchIndex,
    });
    ranges[match.cellId] = list;
  }
  return ranges;
}

export function normalizeMatchIndex(targetIndex: number, totalMatches: number): number {
  if (totalMatches <= 0) return -1;
  return ((targetIndex % totalMatches) + totalMatches) % totalMatches;
}
