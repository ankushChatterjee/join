import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetFullEditorContent = vi.fn(() => "");
const mockGetSelectedText = vi.fn(() => null);
const mockGetCursorPosition = vi.fn(() => null);
const mockGetEditorView = vi.fn(() => null);
const mockInsertTextAtCursor = vi.fn(() => {});

vi.mock("@/components/editor/editorUtils", () => ({
  getFullEditorContent: () => mockGetFullEditorContent(),
  getSelectedText: () => mockGetSelectedText(),
  getCursorPosition: () => mockGetCursorPosition(),
  getEditorView: () => mockGetEditorView(),
  insertTextAtCursor: (text: string) => mockInsertTextAtCursor(text),
}));

let useAppStore: (typeof import("@/stores/appStore"))["useAppStore"];
let getEditorContext: (typeof import("./editorTools"))["getEditorContext"];
let insertSql: (typeof import("./editorTools"))["insertSql"];
let replaceEditorContentTool: (typeof import("./editorTools"))["replaceEditorContentTool"];
let addCellTool: (typeof import("./editorTools"))["addCellTool"];

beforeAll(async () => {
  ({ useAppStore } = await import("@/stores/appStore"));
  ({
    getEditorContext,
    insertSql,
    replaceEditorContentTool,
    addCellTool,
  } = await import("./editorTools"));
});

function baseScript() {
  return {
    id: "script-1",
    name: "Test Sheet",
    connectionId: "c1",
    cells: [
      {
        id: "cell-1",
        sql: "SELECT 1",
        proposed_sql: null,
        last_run_at: null,
        last_run_duration_ms: null,
        last_run_successful: null,
      },
    ],
    selectedCellId: "cell-1",
    isDirty: false,
  };
}

describe("editor tools", () => {
  beforeEach(() => {
    mockGetFullEditorContent.mockReset();
    mockGetSelectedText.mockReset();
    mockGetCursorPosition.mockReset();
    mockGetEditorView.mockReset();
    mockInsertTextAtCursor.mockReset();

    mockGetFullEditorContent.mockReturnValue("SELECT 1");
    mockGetSelectedText.mockReturnValue(null);
    mockGetCursorPosition.mockReturnValue({ line: 1, col: 1 });

    useAppStore.setState({
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
      openScripts: [baseScript()],
      openResultTabs: [],
    });
  });

  describe("get_editor_context", () => {
    it("returns script mode when script is active", async () => {
      const raw = await (getEditorContext as any).execute();
      const parsed = JSON.parse(raw);

      expect(parsed.editorMode).toBe("script");
      expect(parsed.sheetName).toBe("Test Sheet");
      expect(parsed.cellCount).toBe(1);
      expect(parsed.cells).toHaveLength(1);
      expect(parsed.cells[0].sql).toBe("SELECT 1");
      expect(parsed.selectedCellNumber).toBe(1);
    });

    it("returns result mode when result tab is active", async () => {
      useAppStore.setState({
        activeEditorTab: { kind: "result", id: "result-1" },
        openResultTabs: [
          {
            id: "result-1",
            name: "Query Result",
            connectionId: "c1",
            sqlCell: { id: "r1-cell", sql: "SELECT * FROM t", proposed_sql: null },
            queryResults: null,
            lastExecutedAt: null,
            lastExecutedDatabase: null,
            previewSource: null,
            resultSource: "live",
            savedResultId: null,
            isQueryCollapsed: true,
            isStale: false,
            isDirty: false,
            version: 1,
            createdAt: 1_700_000_000_000,
          },
        ],
      });
      mockGetFullEditorContent.mockReturnValue("SELECT * FROM t");

      const raw = await (getEditorContext as any).execute();
      const parsed = JSON.parse(raw);

      expect(parsed.editorMode).toBe("result");
      expect(parsed.resultTabName).toBe("Query Result");
      expect(parsed.selectedCellContent).toContain("SELECT");
    });
  });

  describe("insert_sql", () => {
    it("returns message when no cell is selected", async () => {
      useAppStore.setState({
        openScripts: [{ ...baseScript(), selectedCellId: null }],
      });

      const result = await (insertSql as any).execute({ sql: " LIMIT 10" });

      expect(result).toContain("No cell is selected");
    });

    it("appends sql to selected cell when editor view is not available", async () => {
      const updateScriptContent = vi.fn(() => {});
      useAppStore.setState({
        openScripts: [baseScript()],
        updateScriptContent: updateScriptContent as any,
      });

      const result = await (insertSql as any).execute({ sql: " LIMIT 10" });

      expect(result).toContain("Inserted SQL");
      expect(updateScriptContent).toHaveBeenCalledWith("script-1", "SELECT 1 LIMIT 10");
    });

    it("appends sql to result tab when result tab is active", async () => {
      const updateResultTabSql = vi.fn(() => {});
      useAppStore.setState({
        activeEditorTab: { kind: "result", id: "result-1" },
        openResultTabs: [
          {
            id: "result-1",
            name: "Result",
            connectionId: "c1",
            sqlCell: { id: "r1-cell", sql: "SELECT 1", proposed_sql: null },
            queryResults: null,
            lastExecutedAt: null,
            lastExecutedDatabase: null,
            previewSource: null,
            resultSource: "live",
            savedResultId: null,
            isQueryCollapsed: true,
            isStale: false,
            isDirty: false,
            version: 1,
            createdAt: 1_700_000_000_000,
          },
        ],
        updateResultTabSql: updateResultTabSql as any,
      });

      const result = await (insertSql as any).execute({ sql: " LIMIT 5" });

      expect(result).toContain("Inserted SQL");
      expect(updateResultTabSql).toHaveBeenCalledWith("result-1", "SELECT 1 LIMIT 5");
    });
  });

  describe("replace_editor_content", () => {
    it("returns message when no active script", async () => {
      useAppStore.setState({
        activeScriptId: null,
        activeEditorTab: null,
        openScripts: [],
      });

      const result = await (replaceEditorContentTool as any).execute({
        sql: "SELECT * FROM orders",
      });

      expect(result).toContain("No active SQL sheet");
    });

    it("returns message when no cell selected", async () => {
      useAppStore.setState({
        openScripts: [{ ...baseScript(), selectedCellId: null }],
      });

      const result = await (replaceEditorContentTool as any).execute({
        sql: "SELECT * FROM orders",
      });

      expect(result).toContain("No cell is selected");
    });

    it("proposes changes to script cell", async () => {
      const updateScriptCellProposal = vi.fn(() => {});
      useAppStore.setState({
        updateScriptCellProposal: updateScriptCellProposal as any,
      });

      const result = await (replaceEditorContentTool as any).execute({
        sql: "SELECT * FROM orders LIMIT 10",
      });

      expect(result).toContain("Proposed changes");
      expect(result).toContain("diff viewer");
      expect(updateScriptCellProposal).toHaveBeenCalledWith(
        "script-1",
        "cell-1",
        "SELECT * FROM orders LIMIT 10"
      );
    });

    it("proposes changes to result tab", async () => {
      const updateResultTabProposal = vi.fn(() => {});
      useAppStore.setState({
        activeEditorTab: { kind: "result", id: "result-1" },
        openResultTabs: [
          {
            id: "result-1",
            name: "Result",
            connectionId: "c1",
            sqlCell: { id: "r1-cell", sql: "SELECT 1", proposed_sql: null },
            queryResults: null,
            lastExecutedAt: null,
            lastExecutedDatabase: null,
            previewSource: null,
            resultSource: "live",
            savedResultId: null,
            isQueryCollapsed: true,
            isStale: false,
            isDirty: false,
            version: 1,
            createdAt: 1_700_000_000_000,
          },
        ],
        updateResultTabProposal: updateResultTabProposal as any,
      });

      const result = await (replaceEditorContentTool as any).execute({
        sql: "SELECT * FROM t",
      });

      expect(result).toContain("Proposed changes");
      expect(updateResultTabProposal).toHaveBeenCalledWith("result-1", "SELECT * FROM t");
    });
  });

  describe("add_cell", () => {
    it("returns message when result tab is active", async () => {
      useAppStore.setState({
        activeEditorTab: { kind: "result", id: "result-1" },
        openResultTabs: [
          {
            id: "result-1",
            name: "Result",
            connectionId: "c1",
            sqlCell: { id: "r1-cell", sql: "SELECT 1", proposed_sql: null },
            queryResults: null,
            lastExecutedAt: null,
            lastExecutedDatabase: null,
            previewSource: null,
            resultSource: "live",
            savedResultId: null,
            isQueryCollapsed: true,
            isStale: false,
            isDirty: false,
            version: 1,
            createdAt: 1_700_000_000_000,
          },
        ],
      });

      const result = await (addCellTool as any).execute(
        { sql: "SELECT 2" },
        {
          toolCallId: "tool-1",
          experimental_context: {},
          abortSignal: undefined,
        }
      );

      expect(result).toContain("Result tabs only support a single query cell");
    });

    it("returns message when no active script", async () => {
      useAppStore.setState({
        activeScriptId: null,
        openScripts: [],
      });

      const result = await (addCellTool as any).execute(
        {},
        {
          toolCallId: "tool-1",
          experimental_context: {},
          abortSignal: undefined,
        }
      );

      expect(result).toContain("No active SQL sheet");
    });

    it("adds cell when approved and addScriptCell succeeds", async () => {
      const addScriptCell = vi.fn(() => Promise.resolve("cell-2"));
      useAppStore.setState({
        addScriptCell: addScriptCell as any,
      });

      const result = await (addCellTool as any).execute(
        { sql: "SELECT 2" },
        {
          toolCallId: "tool-1",
          experimental_context: {
            onRequestApproval: ({ resolve }: { resolve: (v: boolean) => void }) => resolve(true),
          },
          abortSignal: undefined,
        }
      );

      expect(result).toContain("Added a new cell");
      expect(addScriptCell).toHaveBeenCalledWith("script-1", "SELECT 2", true);
    });

    it("returns denial message when user declines", async () => {
      const result = await (addCellTool as any).execute(
        { sql: "SELECT 2" },
        {
          toolCallId: "tool-1",
          experimental_context: {
            onRequestApproval: ({ resolve }: { resolve: (v: boolean) => void }) => resolve(false),
          },
          abortSignal: undefined,
        }
      );

      expect(result).toContain("User declined");
    });
  });
});
