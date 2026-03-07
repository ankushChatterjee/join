/* @vitest-environment jsdom */

import React, { useEffect } from "react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SqlSheetCell } from "@/stores/types";
import { SqlEditor } from "./SqlEditor";

type MockView = {
  state: {
    doc: {
      length: number;
    };
  };
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
};

const mockViews: MockView[] = [];

vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
}));

vi.mock("./completionSchema", () => ({
  buildCompletionSchema: () => [],
}));

vi.mock("@codemirror/lang-sql", () => ({
  sql: () => ({}),
  PostgreSQL: {},
  MySQL: {},
  SQLite: {},
}));

vi.mock("./DiffViewer", () => ({
  DiffViewer: () => <div>DiffViewer</div>,
}));

vi.mock("@uiw/react-codemirror", () => {
  const MockCodeMirror = (props: {
    value: string;
    onCreateEditor?: (view: MockView) => void;
    onFocus?: () => void;
  }) => {
    useEffect(() => {
      const view: MockView = {
        state: {
          doc: {
            length: props.value.length,
          },
        },
        dispatch: vi.fn(),
        focus: vi.fn(),
      };
      mockViews.push(view);
      props.onCreateEditor?.(view);
    }, []);

    return (
      <div data-testid="mock-cm-editor" tabIndex={0} onFocus={props.onFocus}>
        {props.value}
      </div>
    );
  };
  return { default: MockCodeMirror };
});

vi.mock("@/stores/appStore", async () => {
  let state: Record<string, unknown> = {};

  const useAppStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(state);

  (useAppStore as unknown as { getState: () => Record<string, unknown> }).getState = () => state;

  return {
    useAppStore,
    __setMockState: (next: Record<string, unknown>) => {
      state = next;
    },
  };
});

function makeCell(id: string, sql: string): SqlSheetCell {
  return {
    id,
    sql,
    last_run_at: null,
    last_run_duration_ms: null,
    last_run_successful: null,
    proposed_sql: null,
  };
}

async function setMockStoreState(cells: SqlSheetCell[], selectedCellId: string) {
  const appStore = await import("@/stores/appStore");
  const script = {
    id: "script-1",
    name: "Sheet 1",
    connectionId: "conn-1",
    cells,
    selectedCellId,
    isDirty: false,
  };

  const state = {
    connections: [{ id: "conn-1", name: "Local", db_type: "postgresql", is_connected: true }],
    openScripts: [script],
    activeScriptId: "script-1",
    updateScriptContent: vi.fn(),
    tablesBySchema: {},
    viewsBySchema: {},
    columns: {},
    setSelectedScriptCell: vi.fn((scriptId: string, cellId: string) => {
      if (scriptId !== "script-1") return;
      script.selectedCellId = cellId;
    }),
    addScriptCell: vi.fn(),
    removeScriptCell: vi.fn(),
    executeScriptCell: vi.fn(),
    executingCell: null,
  };

  (appStore as unknown as { __setMockState: (v: Record<string, unknown>) => void }).__setMockState(
    state as unknown as Record<string, unknown>
  );
}

describe("SqlEditor search behavior", () => {
  beforeEach(() => {
    mockViews.length = 0;
  });

  it("keeps focus in search input and traverses matches on Enter", async () => {
    await setMockStoreState([makeCell("cell-1", "alpha beta alpha gamma alpha")], "cell-1");
    render(<SqlEditor />);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByPlaceholderText("Find in SQL sheet");
    fireEvent.change(input, { target: { value: "alpha" } });

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockViews[0]?.dispatch).toHaveBeenCalledTimes(1));
    expect(input).toHaveFocus();
    expect(mockViews[0].dispatch).toHaveBeenLastCalledWith({
      selection: { anchor: 0, head: 5 },
      scrollIntoView: true,
    });

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockViews[0]?.dispatch).toHaveBeenCalledTimes(2));
    expect(input).toHaveFocus();
    expect(mockViews[0].dispatch).toHaveBeenLastCalledWith({
      selection: { anchor: 11, head: 16 },
      scrollIntoView: true,
    });
  });

  it("uses Shift+Enter for backwards traversal", async () => {
    await setMockStoreState([makeCell("cell-1", "alpha beta alpha gamma alpha")], "cell-1");
    render(<SqlEditor />);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByPlaceholderText("Find in SQL sheet");
    fireEvent.change(input, { target: { value: "alpha" } });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockViews[0]?.dispatch).toHaveBeenCalledTimes(2));

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(mockViews[0]?.dispatch).toHaveBeenCalledTimes(3));
    expect(mockViews[0].dispatch).toHaveBeenLastCalledWith({
      selection: { anchor: 0, head: 5 },
      scrollIntoView: true,
    });
  });

  it("expands collapsed target cell before jumping to its match", async () => {
    await setMockStoreState([makeCell("cell-1", "SELECT 1"), makeCell("cell-2", "needle here")], "cell-2");
    render(<SqlEditor />);

    const collapseButtons = screen.getAllByTitle("Collapse cell");
    fireEvent.click(collapseButtons[1]);
    expect(screen.getByText(/PREVIEW/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByPlaceholderText("Find in SQL sheet");
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByText(/PREVIEW/i)).not.toBeInTheDocument());
    await waitFor(() => {
      const jumped = mockViews.some((view) =>
        view.dispatch.mock.calls.some(
          ([arg]) =>
            arg?.selection?.anchor === 0 &&
            arg?.selection?.head === 6 &&
            arg?.scrollIntoView === true
        )
      );
      expect(jumped).toBe(true);
    });
  });

  it("renders floating search UI outside scroll container", async () => {
    await setMockStoreState([makeCell("cell-1", "alpha")], "cell-1");
    render(<SqlEditor />);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByPlaceholderText("Find in SQL sheet");

    const panelScroll = input.closest(".panel-scroll");
    expect(panelScroll).toBeNull();
    expect(input.closest(".absolute")).toBeInTheDocument();
  });
});
