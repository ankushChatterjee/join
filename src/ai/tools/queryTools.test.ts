import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

const invokeMock: any = mock((..._args: any[]) => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let useAppStore: (typeof import("@/stores/appStore"))["useAppStore"];
let executeReadonlySql: (typeof import("./queryTools"))["executeReadonlySql"];
let getQueryHistory: (typeof import("./queryTools"))["getQueryHistory"];
let lintSqlSafety: (typeof import("./queryTools"))["lintSqlSafety"];
let readResults: (typeof import("./queryTools"))["readResults"];

beforeAll(async () => {
  ({ useAppStore } = await import("@/stores/appStore"));
  ({ executeReadonlySql, getQueryHistory, lintSqlSafety, readResults } = await import("./queryTools"));
});

function baseExecutionContext() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    targetConnectionId: "c1",
    targetConnectionDialect: "postgresql",
    activeEditorKind: "script",
    activeScriptId: null,
    activeResultTabId: null,
    savedResultId: null,
    metadataVersion: null,
    resultVersion: null,
    capturedAt: Date.now(),
    metadataIsFresh: true,
    metadataWarning: null,
  };
}

describe("query tools", () => {
  beforeEach(() => {
    invokeMock.mockReset();
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
      openResultTabs: [],
      activeEditorTab: null,
      queryHistory: [],
    });
  });

  it("execute_readonly_sql requires approval and returns denial message", async () => {
    const result = await (executeReadonlySql as any).execute(
      { sql: "SELECT 1" },
      {
        toolCallId: "tool-1",
        experimental_context: {
          executionContext: baseExecutionContext(),
          onRequestApproval: ({ resolve }: { resolve: (approved: boolean) => void }) =>
            resolve(false),
        },
      },
    );

    expect(String(result)).toContain("User declined");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("execute_readonly_sql throws when connection is not active", async () => {
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
    });

    await expect(
      (executeReadonlySql as any).execute(
        { sql: "SELECT 1" },
        {
          toolCallId: "tool-2",
          experimental_context: { executionContext: baseExecutionContext() },
        },
      ),
    ).rejects.toThrow("not connected");
  });

  it("read_results paginates active result tab rows", async () => {
    useAppStore.setState({
      openResultTabs: [
        {
          id: "result-1",
          name: "Result 1",
          connectionId: "c1",
          sqlCell: { id: "result-1-cell", sql: "SELECT * FROM t", proposed_sql: null },
          queryResults: {
            columns: [{ name: "id", type_name: "int4" }, { name: "name", type_name: "text" }],
            rows: [
              [1, "a"],
              [2, "b"],
              [3, "c"],
            ],
            row_count: 3,
            execution_time_ms: 4,
          },
          lastExecutedAt: 1_700_000_000_000,
          lastExecutedDatabase: "join_test",
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
      activeEditorTab: { kind: "result", id: "result-1" },
    });

    const raw = await (readResults as any).execute({ offset: 1, limit: 1 });
    const parsed = JSON.parse(raw);

    expect(parsed.batch.returned_rows).toBe(1);
    expect(parsed.rows[0].id).toBe(2);
    expect(parsed.batch.has_more).toBe(true);
  });

  it("get_query_history returns recent entries with limit", async () => {
    useAppStore.setState({
      queryHistory: [
        {
          sql: "SELECT 1",
          connectionName: "Main DB",
          timestamp: 1_700_000_000_000,
          rowCount: 1,
          executionTimeMs: 5,
          error: null,
        },
        {
          sql: "SELECT * FROM orders",
          connectionName: "Main DB",
          timestamp: 1_700_000_000_100,
          rowCount: 10,
          executionTimeMs: 12,
          error: null,
        },
      ],
    });

    const raw = await (getQueryHistory as any).execute({ limit: "1" });
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].sql).toBe("SELECT 1");
    expect(parsed[0].connectionName).toBe("Main DB");
    expect(parsed[0].rowCount).toBe(1);
  });

  it("get_query_history uses default limit when not provided", async () => {
    useAppStore.setState({
      queryHistory: Array(20)
        .fill(null)
        .map((_, i) => ({
          sql: `SELECT ${i}`,
          connectionName: "Main DB",
          timestamp: 1_700_000_000_000 + i,
          rowCount: 1,
          executionTimeMs: 1,
          error: null,
        })),
    });

    const raw = await (getQueryHistory as any).execute({});
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveLength(10);
  });

  it("lint_sql_safety reports high risk for write queries", async () => {
    const raw = await (lintSqlSafety as any).execute({
      sql: "DELETE FROM orders;",
    });
    const parsed = JSON.parse(raw);
    const highWarnings = parsed.warnings.filter((w: { severity: string }) => w.severity === "high");

    expect(parsed.safe).toBe(false);
    expect(highWarnings.length).toBeGreaterThan(0);
  });
});
