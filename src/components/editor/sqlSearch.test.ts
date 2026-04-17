import { describe, expect, it } from "bun:test";
import type { SqlSheetCell } from "@/stores/types";
import {
  buildHighlightRangesByCell,
  buildSearchableCells,
  findSheetMatches,
  normalizeMatchIndex,
} from "./sqlSearch";

function cell(id: string, sql: string): SqlSheetCell {
  return {
    id,
    sql,
    last_run_at: null,
    last_run_duration_ms: null,
    last_run_successful: null,
    proposed_sql: null,
  };
}

describe("SQL sheet search", () => {
  it("only builds searchable cells while search is open", () => {
    const cells = [cell("a", "SELECT 1"), cell("b", "SELECT 2")];
    expect(buildSearchableCells(cells, false)).toEqual([]);
    expect(buildSearchableCells(cells, true)).toEqual([
      { cellId: "a", cellIndex: 0, textLower: "select 1" },
      { cellId: "b", cellIndex: 1, textLower: "select 2" },
    ]);
  });

  it("finds ordered case-insensitive matches across cells", () => {
    const searchable = buildSearchableCells([cell("a", "alpha x ALPHA"), cell("b", "zz alpha")], true);
    expect(findSheetMatches(searchable, "alpha")).toEqual([
      { cellId: "a", cellIndex: 0, from: 0, to: 5 },
      { cellId: "a", cellIndex: 0, from: 8, to: 13 },
      { cellId: "b", cellIndex: 1, from: 3, to: 8 },
    ]);
  });

  it("handles empty queries, match caps, highlights, and cyclic traversal", () => {
    const searchable = buildSearchableCells([cell("a", "x x x x x")], true);
    expect(findSheetMatches(searchable, " ")).toEqual([]);
    expect(findSheetMatches(searchable, "x", 3).map((m) => m.from)).toEqual([0, 2, 4]);
    expect(buildHighlightRangesByCell(findSheetMatches(searchable, "x", 3), 1)).toEqual({
      a: [
        { from: 0, to: 1, isActive: false },
        { from: 2, to: 3, isActive: true },
        { from: 4, to: 5, isActive: false },
      ],
    });
    expect(normalizeMatchIndex(3, 3)).toBe(0);
    expect(normalizeMatchIndex(-1, 3)).toBe(2);
    expect(normalizeMatchIndex(1, 0)).toBe(-1);
  });
});
