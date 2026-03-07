import { describe, it, expect, mock } from "bun:test";
import { addCodeInNewCell } from "./chatMessageActions";

describe("addCodeInNewCell", () => {
  it("adds SQL to a newly created cell when an active script tab is open", async () => {
    const addScriptCell = mock(async () => "cell-2");
    const showToast = mock(() => {});

    await addCodeInNewCell({
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
      code: "SELECT 1;",
      addScriptCell,
      showToast,
    });

    expect(addScriptCell).toHaveBeenCalledTimes(1);
    expect(addScriptCell).toHaveBeenCalledWith("script-1", "SELECT 1;", true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows info toast and skips add when no script is active", async () => {
    const addScriptCell = mock(async () => "cell-2");
    const showToast = mock(() => {});

    await addCodeInNewCell({
      activeScriptId: null,
      activeEditorTab: { kind: "script", id: "script-1" },
      code: "SELECT 1;",
      addScriptCell,
      showToast,
    });

    expect(addScriptCell).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("info", "Open a script tab to add this query in a new cell.");
  });

  it("shows info toast and skips add when active tab is not a script tab", async () => {
    const addScriptCell = mock(async () => "cell-2");
    const showToast = mock(() => {});

    await addCodeInNewCell({
      activeScriptId: "script-1",
      activeEditorTab: { kind: "result", id: "result-1" },
      code: "SELECT 1;",
      addScriptCell,
      showToast,
    });

    expect(addScriptCell).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("info", "Open a script tab to add this query in a new cell.");
  });

  it("shows error toast when addScriptCell returns null", async () => {
    const addScriptCell = mock(async () => null);
    const showToast = mock(() => {});

    await addCodeInNewCell({
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
      code: "SELECT 1;",
      addScriptCell,
      showToast,
    });

    expect(addScriptCell).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", "Failed to add a new cell.");
  });

  it("shows error toast when addScriptCell throws", async () => {
    const addScriptCell = mock(async () => {
      throw new Error("boom");
    });
    const showToast = mock(() => {});

    await addCodeInNewCell({
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
      code: "SELECT 1;",
      addScriptCell,
      showToast,
    });

    expect(addScriptCell).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", "Failed to add a new cell.");
  });
});
