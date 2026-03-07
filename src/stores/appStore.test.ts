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
    connections: [],
    activeConnectionId: null,
    queryResults: null,
    isExecuting: false,
    queryError: null,
    queryHistory: [],
    previewSource: null,
    querySql: null,
    lastQueryContext: null,
    openScripts: [],
    activeScriptId: null,
    openResultTabs: [],
    activeEditorTab: null,
    scriptsByConnection: {},
    savedResultsByConnection: {},
    toasts: [],
  });
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
    expect(invokeMock).toHaveBeenCalledWith("connect", { connectionId: "c1" });
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
