import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock: any = vi.fn((..._args: any[]) => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let useAppStore: (typeof import("./appStore"))["useAppStore"];

beforeAll(async () => {
  ({ useAppStore } = await import("./appStore"));
});

function resetStore() {
  useAppStore.setState({
    activeProject: {
      id: "p1",
      name: "Test Project",
      rootPath: "/tmp/test-project",
      createdAt: 1,
      updatedAt: 1,
    },
    connections: [],
    activeConnectionId: null,
    queryResults: null,
    isExecuting: false,
    queryError: null,
    queryHistory: [],
    previewSource: null,
    querySql: null,
    lastQueryContext: null,
    parameterDefaults: {},
    pendingSqlParameterPrompt: null,
    openScripts: [],
    activeScriptId: null,
    openResultTabs: [],
    activeEditorTab: null,
    scriptsByConnection: {},
    savedResultsByConnection: {},
    toasts: [],
  });
}

function makeOpenScript(overrides?: Partial<any>) {
  return {
    id: "script-1",
    name: "Script 1",
    connectionId: "c1",
    cells: [
      {
        id: "cell-1",
        sql: "SELECT 1",
        last_run_at: null,
        last_run_duration_ms: null,
        last_run_successful: null,
        proposed_sql: null,
      },
      {
        id: "cell-2",
        sql: "SELECT 2",
        last_run_at: null,
        last_run_duration_ms: null,
        last_run_successful: null,
        proposed_sql: null,
      },
    ],
    selectedCellId: "cell-1",
    isDirty: false,
    pendingSaveRevision: 0,
    lastFlushedRevision: 0,
    ...overrides,
  };
}

describe("appStore critical flows", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
  });

  it("executeQuery auto-connects and persists successful history", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "connect") return Promise.resolve(undefined);
      if (cmd === "list_connections") {
        return Promise.resolve([
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
        ]);
      }
      if (cmd === "execute_query") {
        return Promise.resolve({
          columns: [{ name: "id", type_name: "int4" }],
          rows: [[1]],
          row_count: 1,
          execution_time_ms: 7,
        });
      }
      return Promise.resolve(undefined);
    });

    useAppStore.setState({
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
          is_connected: false,
        },
      ],
      openScripts: [
        {
          id: "script-1",
          name: "Script 1",
          connectionId: "c1",
          cells: [{ id: "cell-1", sql: "SELECT 1", last_run_at: null, last_run_duration_ms: null, last_run_successful: null, proposed_sql: null }],
          selectedCellId: "cell-1",
          isDirty: false,
          pendingSaveRevision: 0,
          lastFlushedRevision: 0,
        },
      ],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    await useAppStore.getState().executeQuery("SELECT 1");

    const state = useAppStore.getState();
    expect(state.queryError).toBeNull();
    expect(state.queryResults?.row_count).toBe(1);
    expect(state.queryHistory.length).toBe(1);
    expect(state.queryHistory[0].error).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith(
      "connect",
      expect.objectContaining({ connectionId: "c1", projectRoot: "/tmp/test-project" })
    );
    expect(invokeMock).toHaveBeenCalledWith("execute_query", { connectionId: "c1", sql: "SELECT 1" });
  });

  it("executeQuery captures failure path and history", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "execute_query") {
        return Promise.reject("boom");
      }
      return Promise.resolve(undefined);
    });

    useAppStore.setState({
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
      openScripts: [
        {
          id: "script-1",
          name: "Script 1",
          connectionId: "c1",
          cells: [{ id: "cell-1", sql: "SELECT * FROM missing", last_run_at: null, last_run_duration_ms: null, last_run_successful: null, proposed_sql: null }],
          selectedCellId: "cell-1",
          isDirty: false,
          pendingSaveRevision: 0,
          lastFlushedRevision: 0,
        },
      ],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    await useAppStore.getState().executeQuery("SELECT * FROM missing");

    const state = useAppStore.getState();
    expect(state.queryResults).toBeNull();
    expect(String(state.queryError)).toContain("boom");
    expect(state.queryHistory.length).toBe(1);
    expect(String(state.queryHistory[0].error)).toContain("boom");
  });

  it("executeQuery stringifies Error object rejections for panel-safe queryError", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "execute_query") {
        return Promise.reject(new Error("db exploded"));
      }
      return Promise.resolve(undefined);
    });

    useAppStore.setState({
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
      openScripts: [
        {
          id: "script-1",
          name: "Script 1",
          connectionId: "c1",
          cells: [{ id: "cell-1", sql: "SELECT * FROM boom", last_run_at: null, last_run_duration_ms: null, last_run_successful: null, proposed_sql: null }],
          selectedCellId: "cell-1",
          isDirty: false,
          pendingSaveRevision: 0,
          lastFlushedRevision: 0,
        },
      ],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    await useAppStore.getState().executeQuery("SELECT * FROM boom");

    const state = useAppStore.getState();
    expect(state.queryResults).toBeNull();
    expect(typeof state.queryError).toBe("string");
    expect(state.queryError).toContain("db exploded");
    expect(state.queryHistory.length).toBe(1);
    expect(typeof state.queryHistory[0].error).toBe("string");
    expect(String(state.queryHistory[0].error)).toContain("db exploded");
  });

  it("add/remove SQL cells keeps selection valid", async () => {
    invokeMock.mockResolvedValue(undefined);

    useAppStore.setState({
      openScripts: [
        {
          id: "script-1",
          name: "Script 1",
          connectionId: "c1",
          cells: [{ id: "cell-1", sql: "SELECT 1", last_run_at: null, last_run_duration_ms: null, last_run_successful: null, proposed_sql: null }],
          selectedCellId: "cell-1",
          isDirty: false,
          pendingSaveRevision: 0,
          lastFlushedRevision: 0,
        },
      ],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    const createdId = await useAppStore.getState().addScriptCell("script-1", "SELECT 2", true);
    expect(createdId).toBeTruthy();
    let script = useAppStore.getState().openScripts[0];
    expect(script.cells.length).toBe(2);
    expect(script.selectedCellId).toBe(createdId);

    await useAppStore.getState().removeScriptCell("script-1", createdId!);
    script = useAppStore.getState().openScripts[0];
    expect(script.cells.length).toBe(1);
    expect(script.selectedCellId).toBe("cell-1");
  });

  it("open/rename/delete saved results updates tabs and lists", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_saved_result") {
        return Promise.resolve({
          id: "sr-1",
          name: "Saved Result",
          connection_id: payload.connectionId,
          sql: "SELECT 1",
          preview_source: null,
          row_count: 1,
          execution_time_ms: 2,
          created_at: 1000,
          updated_at: 2000,
          query_result: {
            columns: [{ name: "id", type_name: "int4" }],
            rows: [[1]],
            row_count: 1,
            execution_time_ms: 2,
          },
        });
      }
      if (cmd === "rename_saved_result") {
        return Promise.resolve({
          id: payload.savedResultId,
          name: payload.newName,
          connection_id: payload.connectionId,
          sql: "SELECT 1",
          preview_source: null,
          row_count: 1,
          execution_time_ms: 2,
          created_at: 1000,
          updated_at: 3000,
        });
      }
      if (cmd === "delete_saved_result") {
        return Promise.resolve(undefined);
      }
      if (cmd === "save_tabs") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    useAppStore.setState({
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
      savedResultsByConnection: {
        c1: [
          {
            id: "sr-1",
            name: "Saved Result",
            connection_id: "c1",
            sql: "SELECT 1",
            preview_source: null,
            row_count: 1,
            execution_time_ms: 2,
            created_at: 1000,
            updated_at: 2000,
          },
        ],
      },
    });

    await useAppStore.getState().openSavedResult("c1", "sr-1");
    expect(useAppStore.getState().openResultTabs.length).toBe(1);
    expect(useAppStore.getState().activeEditorTab?.kind).toBe("result");

    await useAppStore.getState().renameSavedResult("c1", "sr-1", "Renamed");
    expect(useAppStore.getState().openResultTabs[0].name).toBe("Renamed");
    expect(useAppStore.getState().savedResultsByConnection.c1[0].name).toBe("Renamed");

    await useAppStore.getState().deleteSavedResult("c1", "sr-1");
    expect(useAppStore.getState().openResultTabs.length).toBe(0);
    expect(useAppStore.getState().savedResultsByConnection.c1.length).toBe(0);
  });

  it("stores parameter defaults by connection + normalized sql + mode", () => {
    const sqlA = "SELECT *   FROM users WHERE id = :id ;";
    const sqlB = "SELECT * FROM users WHERE id = :id";

    useAppStore
      .getState()
      .saveParameterDefaults("c1", sqlA, "named", {
        mode: "named",
        values: { id: "42" },
      });

    const defaults = useAppStore.getState().getParameterDefaults("c1", sqlB, "named", {
      mode: "named",
      names: ["id"],
      occurrences: [{ name: "id", start: 31, end: 34 }],
    });
    expect(defaults).toEqual({
      mode: "named",
      values: { id: "42" },
    });

    const miss = useAppStore.getState().getParameterDefaults("c2", sqlB, "named", {
      mode: "named",
      names: ["id"],
      occurrences: [{ name: "id", start: 31, end: 34 }],
    });
    expect(miss).toEqual({
      mode: "named",
      values: { id: null },
    });
  });

  it("request/submit parameter prompt resolves and clears pending state", async () => {
    const requestPromise = useAppStore
      .getState()
      .requestSqlParameters("c1", "SELECT * FROM t WHERE id = :id", {
        mode: "named",
        names: ["id"],
        occurrences: [{ name: "id", start: 27, end: 30 }],
      });

    expect(useAppStore.getState().pendingSqlParameterPrompt).not.toBeNull();

    useAppStore.getState().submitSqlParameterPrompt({
      mode: "named",
      values: { id: "123" },
    });

    await expect(requestPromise).resolves.toEqual({
      mode: "named",
      values: { id: "123" },
    });
    expect(useAppStore.getState().pendingSqlParameterPrompt).toBeNull();
  });

  it("request/cancel parameter prompt resolves null and does not save defaults", async () => {
    const requestPromise = useAppStore
      .getState()
      .requestSqlParameters("c1", "SELECT * FROM t WHERE id = ?", {
        mode: "positional",
        count: 1,
        occurrences: [{ index: 0, start: 27, end: 28 }],
      });

    useAppStore.getState().cancelSqlParameterPrompt();

    await expect(requestPromise).resolves.toBeNull();
    expect(useAppStore.getState().pendingSqlParameterPrompt).toBeNull();
    expect(useAppStore.getState().parameterDefaults).toEqual({});
  });
});

describe("appStore autosave regressions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
  });

  it("queues script updates on edit and flushes after debounce without direct hot-path write", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "queue_script_update") return Promise.resolve({});
        if (cmd === "flush_script_updates") {
          return Promise.resolve({
            scriptId: "script-1",
            pendingRevision: null,
            lastFlushedRevision: 1,
            hasPending: false,
          });
        }
        return Promise.resolve(undefined);
      });

      useAppStore.setState({
        openScripts: [
          {
            id: "script-1",
            name: "Script 1",
            connectionId: "c1",
            cells: [{ id: "cell-1", sql: "SELECT 1", last_run_at: null, last_run_duration_ms: null, last_run_successful: null, proposed_sql: null }],
            selectedCellId: "cell-1",
            isDirty: false,
            pendingSaveRevision: 0,
            lastFlushedRevision: 0,
          },
        ],
        activeScriptId: "script-1",
        activeEditorTab: { kind: "script", id: "script-1" },
      });

      useAppStore.getState().updateScriptContent("script-1", "SELECT 2");
      await Promise.resolve();
      expect(invokeMock).toHaveBeenCalledWith(
        "queue_script_update",
        expect.objectContaining({ scriptId: "script-1" })
      );
      expect(
        invokeMock.mock.calls.some((c: any[]) => c[0] === "update_script_content")
      ).toBe(false);

      await vi.advanceTimersByTimeAsync(760);
      await Promise.resolve();
      expect(invokeMock).toHaveBeenCalledWith(
        "flush_script_updates",
        { scriptId: "script-1" }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes pending script updates before executing a cell", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "flush_script_updates") {
        return Promise.resolve({
          scriptId: "script-1",
          pendingRevision: null,
          lastFlushedRevision: 1,
          hasPending: false,
        });
      }
      if (cmd === "execute_query") {
        return Promise.resolve({
          columns: [{ name: "id", type_name: "int4" }],
          rows: [[1]],
          row_count: 1,
          execution_time_ms: 2,
        });
      }
      if (cmd === "save_query_history") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    useAppStore.setState({
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
      openScripts: [
        {
          id: "script-1",
          name: "Script 1",
          connectionId: "c1",
          cells: [{ id: "cell-1", sql: "SELECT 1", last_run_at: null, last_run_duration_ms: null, last_run_successful: null, proposed_sql: null }],
          selectedCellId: "cell-1",
          isDirty: true,
          pendingSaveRevision: 1,
          lastFlushedRevision: 0,
        },
      ],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    await useAppStore.getState().executeScriptCell("script-1", "cell-1");
    const flushCallIndex = invokeMock.mock.calls.findIndex((c: any[]) => c[0] === "flush_script_updates");
    const executeCallIndex = invokeMock.mock.calls.findIndex((c: any[]) => c[0] === "execute_query");
    expect(flushCallIndex).toBeGreaterThanOrEqual(0);
    expect(executeCallIndex).toBeGreaterThanOrEqual(0);
    expect(flushCallIndex).toBeLessThan(executeCallIndex);
  });
});

describe("appStore updateScriptContent behavior lock", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "queue_script_update") return Promise.resolve({});
      return Promise.resolve(undefined);
    });
  });

  it("updates only selected cell while preserving other references", () => {
    const script1 = makeOpenScript();
    const script2 = makeOpenScript({ id: "script-2", name: "Script 2", selectedCellId: "cell-2" });
    useAppStore.setState({
      openScripts: [script1, script2],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    const before = useAppStore.getState();
    const beforeScript1 = before.openScripts[0];
    const beforeScript2 = before.openScripts[1];
    const beforeCell1 = beforeScript1.cells[0];
    const beforeCell2 = beforeScript1.cells[1];

    useAppStore.getState().updateScriptContent("script-1", "SELECT 42");

    const after = useAppStore.getState();
    const afterScript1 = after.openScripts[0];
    const afterScript2 = after.openScripts[1];
    const afterCell1 = afterScript1.cells[0];
    const afterCell2 = afterScript1.cells[1];

    expect(afterCell1.sql).toBe("SELECT 42");
    expect(afterCell2.sql).toBe("SELECT 2");
    expect(afterScript1.isDirty).toBe(true);
    expect(afterScript1.pendingSaveRevision).toBe(1);
    expect(afterScript1.selectedCellId).toBe("cell-1");

    // Updated script/cell should get new references
    expect(afterScript1).not.toBe(beforeScript1);
    expect(afterCell1).not.toBe(beforeCell1);
    // Unchanged cell/script should preserve references
    expect(afterCell2).toBe(beforeCell2);
    expect(afterScript2).toBe(beforeScript2);
    expect(after.activeEditorTab).toEqual({ kind: "script", id: "script-1" });
  });

  it("increments revision once per call and queues persist updates", async () => {
    useAppStore.setState({
      openScripts: [makeOpenScript()],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    useAppStore.getState().updateScriptContent("script-1", "SELECT 100");
    useAppStore.getState().updateScriptContent("script-1", "SELECT 101");
    await Promise.resolve();

    const script = useAppStore.getState().openScripts[0];
    expect(script.pendingSaveRevision).toBe(2);
    expect(script.isDirty).toBe(true);
    expect(script.cells[0].sql).toBe("SELECT 101");

    const queueCalls = invokeMock.mock.calls.filter((c: any[]) => c[0] === "queue_script_update");
    expect(queueCalls.length).toBe(2);
    expect(queueCalls[0][1]).toEqual(expect.objectContaining({ scriptId: "script-1", revision: 1 }));
    expect(queueCalls[1][1]).toEqual(expect.objectContaining({ scriptId: "script-1", revision: 2 }));
  });

  it("is a no-op when script does not exist", () => {
    useAppStore.setState({
      openScripts: [makeOpenScript()],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    const before = useAppStore.getState();
    const beforeScript = before.openScripts[0];

    useAppStore.getState().updateScriptContent("missing-script", "SELECT fail");

    const after = useAppStore.getState();
    expect(after.openScripts[0]).toBe(beforeScript);
    expect(invokeMock.mock.calls.some((c: any[]) => c[0] === "queue_script_update")).toBe(false);
  });

  it("falls back to first cell when selectedCellId is null or invalid", () => {
    useAppStore.setState({
      openScripts: [
        makeOpenScript({ selectedCellId: null }),
        makeOpenScript({ id: "script-2", name: "Script 2", selectedCellId: "missing-cell" }),
      ],
      activeScriptId: "script-1",
      activeEditorTab: { kind: "script", id: "script-1" },
    });

    useAppStore.getState().updateScriptContent("script-1", "SELECT from-null");
    useAppStore.getState().updateScriptContent("script-2", "SELECT from-invalid");

    const [script1, script2] = useAppStore.getState().openScripts;
    expect(script1.selectedCellId).toBe("cell-1");
    expect(script1.cells[0].sql).toBe("SELECT from-null");
    expect(script2.selectedCellId).toBe("cell-1");
    expect(script2.cells[0].sql).toBe("SELECT from-invalid");
  });
});
