// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { addCodeInNewCell } from "./chatMessageActions";
import { ChatMessageComponent } from "./ChatMessage";

describe("addCodeInNewCell", () => {
  it("adds SQL to a newly created cell when an active script tab is open", async () => {
    const addScriptCell = vi.fn(async () => "cell-2");
    const showToast = vi.fn(() => {});

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
    const addScriptCell = vi.fn(async () => "cell-2");
    const showToast = vi.fn(() => {});

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
    const addScriptCell = vi.fn(async () => "cell-2");
    const showToast = vi.fn(() => {});

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
    const addScriptCell = vi.fn(async () => null);
    const showToast = vi.fn(() => {});

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
    const addScriptCell = vi.fn(async () => {
      throw new Error("boom");
    });
    const showToast = vi.fn(() => {});

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

describe("ChatMessageComponent streaming", () => {
  it("keeps streaming text visible when tool parts are present without text parts", () => {
    render(
      <ChatMessageComponent
        message={{
          id: "streaming",
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        }}
        isStreaming={true}
        streamingTextLive={"Running analysis...\nFound issue."}
        streamingTextRendered={"Running analysis..."}
        streamingParts={[
          {
            type: "tool",
            index: 0,
            toolCall: {
              id: "tool-1",
              name: "run_query",
              input: { sql: "select 1" },
              status: "running",
            },
          },
        ]}
        streamingToolCalls={[
          {
            id: "tool-1",
            name: "run_query",
            input: { sql: "select 1" },
            status: "running",
          },
        ]}
      />
    );

    expect(screen.getByText("Running analysis...")).toBeTruthy();
    expect(screen.getByText("Found issue.")).toBeTruthy();
    expect(screen.getByText("run_query")).toBeTruthy();
  });
});
