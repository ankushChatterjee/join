import { describe, expect, it } from "vitest";
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

describe("sqlSearch", () => {
  it("builds searchable cells only when search is open", () => {
    const cells = [cell("a", "SELECT 1"), cell("b", "SELECT 2")];
    expect(buildSearchableCells(cells, false)).toEqual([]);

    const searchable = buildSearchableCells(cells, true);
    expect(searchable).toEqual([
      { cellId: "a", cellIndex: 0, textLower: "select 1" },
      { cellId: "b", cellIndex: 1, textLower: "select 2" },
    ]);
  });

  it("finds matches across cells in order and with correct offsets", () => {
    const searchable = buildSearchableCells(
      [cell("a", "alpha x ALPHA"), cell("b", "zz alpha")],
      true
    );
    const matches = findSheetMatches(searchable, "alpha");

    expect(matches).toEqual([
      { cellId: "a", cellIndex: 0, from: 0, to: 5 },
      { cellId: "a", cellIndex: 0, from: 8, to: 13 },
      { cellId: "b", cellIndex: 1, from: 3, to: 8 },
    ]);
  });

  it("returns no matches for empty or whitespace queries", () => {
    const searchable = buildSearchableCells([cell("a", "alpha")], true);
    expect(findSheetMatches(searchable, "")).toEqual([]);
    expect(findSheetMatches(searchable, "   ")).toEqual([]);
  });

  it("caps matches by maxMatches for performance guardrails", () => {
    const searchable = buildSearchableCells([cell("a", "x x x x x x x x x x")], true);
    const matches = findSheetMatches(searchable, "x", 3);
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.from)).toEqual([0, 2, 4]);
  });

  it("builds highlight ranges with only active match flagged", () => {
    const matches = [
      { cellId: "a", cellIndex: 0, from: 0, to: 5 },
      { cellId: "a", cellIndex: 0, from: 8, to: 13 },
      { cellId: "b", cellIndex: 1, from: 2, to: 7 },
    ];
    const ranges = buildHighlightRangesByCell(matches, 1);

    expect(ranges).toEqual({
      a: [
        { from: 0, to: 5, isActive: false },
        { from: 8, to: 13, isActive: true },
      ],
      b: [{ from: 2, to: 7, isActive: false }],
    });
  });

  it("normalizes match index cyclically for next/previous traversal", () => {
    expect(normalizeMatchIndex(0, 3)).toBe(0);
    expect(normalizeMatchIndex(3, 3)).toBe(0);
    expect(normalizeMatchIndex(-1, 3)).toBe(2);
    expect(normalizeMatchIndex(-4, 3)).toBe(2);
    expect(normalizeMatchIndex(1, 0)).toBe(-1);
  });
});
