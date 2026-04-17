import { describe, expect, it } from "bun:test";
import { addCodeInNewCell } from "./chatMessageActions";

describe("chat message SQL actions", () => {
  it("adds SQL to a new selected cell when a script tab is active", async () => {
    const calls: unknown[][] = [];
    const toasts: unknown[][] = [];

    await addCodeInNewCell({
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
      code: "SELECT 1",
      addScriptCell: async (...args) => {
        calls.push(args);
        return "cell-2";
      },
      showToast: (...args) => toasts.push(args),
    });

    expect(calls).toEqual([["script-1", "SELECT 1", true]]);
    expect(toasts).toEqual([]);
  });

  it("surfaces practical user feedback when adding a cell is unavailable or fails", async () => {
    const toasts: unknown[][] = [];

    await addCodeInNewCell({
      activeScriptId: null,
      activeEditorTab: null,
      code: "SELECT 1",
      addScriptCell: async () => "cell-1",
      showToast: (...args) => toasts.push(args),
    });
    expect(toasts[0]).toEqual(["info", "Open a script tab to add this query in a new cell."]);

    await addCodeInNewCell({
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
      code: "SELECT 1",
      addScriptCell: async () => null,
      showToast: (...args) => toasts.push(args),
    });
    expect(toasts[1]).toEqual(["error", "Failed to add a new cell."]);
  });
});
