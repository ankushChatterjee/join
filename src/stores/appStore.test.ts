import { beforeEach, describe, expect, it, mock } from "bun:test";

const invokeCalls: Array<{ cmd: string; payload: Record<string, unknown> }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload: Record<string, unknown>) => {
    invokeCalls.push({ cmd, payload });
    if (cmd === "flush_script_updates") {
      return { scriptId: payload.scriptId, pendingRevision: null, lastFlushedRevision: 1, hasPending: false };
    }
    return undefined;
  },
}));

const { useAppStore } = await import("./appStore");

function seedScriptState() {
  useAppStore.setState({
    activeProject: {
      id: "p1",
      name: "Project",
      rootPath: "/tmp/project",
      createdAt: 1,
      updatedAt: 1,
    },
    openScripts: [
      {
        id: "s1",
        name: "Sheet 1",
        connectionId: "c1",
        selectedCellId: "cell-1",
        isDirty: false,
        pendingSaveRevision: 0,
        lastFlushedRevision: 0,
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
      },
    ],
    activeScriptId: "s1",
    activeEditorTab: { kind: "script", id: "s1" },
    openResultTabs: [],
    editorTabOrder: [{ kind: "script", id: "s1" }],
    saveOpenTabs: async () => undefined,
  });
}

describe("app store frontend state", () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    useAppStore.setState({
      activeProject: null,
      openScripts: [],
      activeScriptId: null,
      openResultTabs: [],
      activeEditorTab: null,
      editorTabOrder: [],
      queryResults: null,
      querySql: null,
      previewSource: null,
      activeConnectionId: null,
      connections: [],
      parameterDefaults: {},
      pendingSqlParameterPrompt: null,
    });
  });

  it("updates only the selected SQL sheet cell and marks the sheet dirty", async () => {
    seedScriptState();

    useAppStore.getState().updateScriptContent("s1", "SELECT 2");

    const script = useAppStore.getState().openScripts[0];
    expect(script.cells[0].sql).toBe("SELECT 2");
    expect(script.isDirty).toBe(true);
    expect(script.pendingSaveRevision).toBe(1);
    await useAppStore.getState().flushScriptNow("s1");
  });

  it("adds cells after the selected cell and can keep the previous selection", async () => {
    seedScriptState();

    const newCellId = await useAppStore.getState().addScriptCell("s1", "SELECT 2", false);
    await useAppStore.getState().flushScriptNow("s1");

    const script = useAppStore.getState().openScripts[0];
    expect(newCellId).not.toBeNull();
    expect(script.cells.map((cell) => cell.sql)).toEqual(["SELECT 1", "SELECT 2"]);
    expect(script.selectedCellId).toBe("cell-1");
  });

  it("stores, accepts, and rejects proposed SQL changes", async () => {
    seedScriptState();
    const store = useAppStore.getState();

    store.updateScriptCellProposal("s1", "cell-1", "SELECT 42");
    expect(useAppStore.getState().openScripts[0].cells[0].proposed_sql).toBe("SELECT 42");

    useAppStore.getState().acceptScriptCellProposal("s1", "cell-1");
    await useAppStore.getState().flushScriptNow("s1");
    expect(useAppStore.getState().openScripts[0].cells[0].sql).toBe("SELECT 42");
    expect(useAppStore.getState().openScripts[0].cells[0].proposed_sql).toBeNull();

    useAppStore.getState().updateScriptCellProposal("s1", "cell-1", "SELECT 99");
    useAppStore.getState().rejectScriptCellProposal("s1", "cell-1");
    expect(useAppStore.getState().openScripts[0].cells[0].proposed_sql).toBeNull();
  });

  it("pops current query results into a result tab and edits its SQL independently", () => {
    useAppStore.setState({
      activeConnectionId: "c1",
      connections: [
        {
          id: "c1",
          name: "Main DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          database: "join_test",
          username: "join",
          ssl_mode: "disable",
          is_connected: true,
        },
      ],
      querySql: "SELECT * FROM users",
      queryResults: {
        columns: [{ name: "id", type_name: "int4" }],
        rows: [[1]],
        row_count: 1,
        execution_time_ms: 5,
      },
      previewSource: "public.users",
      openResultTabs: [],
      saveOpenTabs: async () => undefined,
    });

    useAppStore.getState().popOutResultsToTab();
    const tab = useAppStore.getState().openResultTabs[0];
    expect(tab.name).toBe("Result 1");
    expect(tab.sqlCell.sql).toBe("SELECT * FROM users");
    expect(useAppStore.getState().activeEditorTab).toEqual({ kind: "result", id: tab.id });

    useAppStore.getState().updateResultTabSql(tab.id, "SELECT id FROM users");
    expect(useAppStore.getState().openResultTabs[0].sqlCell.sql).toBe("SELECT id FROM users");
    expect(useAppStore.getState().openResultTabs[0].version).toBe(2);
  });
});
