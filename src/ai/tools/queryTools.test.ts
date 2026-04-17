import { beforeEach, describe, expect, it, mock } from "bun:test";

type InvokeCall = { cmd: string; payload: Record<string, unknown> };
const invokeCalls: InvokeCall[] = [];
let invokeImpl: (cmd: string, payload: Record<string, unknown>) => unknown | Promise<unknown> = () => undefined;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload: Record<string, unknown>) => {
    invokeCalls.push({ cmd, payload });
    return invokeImpl(cmd, payload);
  },
}));

const { useAppStore } = await import("@/stores/appStore");
const { executeReadonlySql, getQueryHistory, lintSqlSafety, readResults } = await import("./queryTools");

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

function resetStore() {
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
    parameterDefaults: {},
    pendingSqlParameterPrompt: null,
  });
}

describe("AI query tools", () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    invokeImpl = () => undefined;
    resetStore();
  });

  it("requires approval before executing read-only SQL", async () => {
    const result = await executeReadonlySql.execute!(
      { sql: "SELECT 1" },
      {
        toolCallId: "tool-1",
        messages: [],
        experimental_context: {
          executionContext: baseExecutionContext(),
          onRequestApproval: ({ resolve }: { resolve: (approved: boolean) => void }) => resolve(false),
        },
      } as never
    );

    expect(String(result)).toContain("User declined");
    expect(invokeCalls).toHaveLength(0);
  });

  it("throws when the resolved connection is not connected", async () => {
    useAppStore.setState({
      connections: [{ ...useAppStore.getState().connections[0], is_connected: false }],
    });

    await expect(
      executeReadonlySql.execute!(
        { sql: "SELECT 1" },
        {
          toolCallId: "tool-2",
          messages: [],
          experimental_context: { executionContext: baseExecutionContext() },
        } as never
      )
    ).rejects.toThrow("not connected");
  });

  it("executes approved SQL and formats result rows", async () => {
    invokeImpl = async () => ({
      columns: [{ name: "id" }, { name: "name" }],
      rows: [
        [1, "Ada"],
        [2, "Linus"],
      ],
      row_count: 2,
      execution_time_ms: 7,
    });

    const result = await executeReadonlySql.execute!(
      { sql: "SELECT id, name FROM users" },
      {
        toolCallId: "tool-3",
        messages: [],
        experimental_context: {
          executionContext: baseExecutionContext(),
          onRequestApproval: ({ resolve }: { resolve: (approved: boolean) => void }) => resolve(true),
        },
      } as never
    );

    expect(invokeCalls[0]).toEqual({
      cmd: "execute_query",
      payload: { connectionId: "c1", sql: "SELECT id, name FROM users" },
    });
    expect(String(result)).toContain("Columns: id, name");
    expect(String(result)).toContain('"name":"Ada"');
  });

  it("reads active result tab rows in batches", async () => {
    useAppStore.setState({
      openResultTabs: [
        {
          id: "result-1",
          name: "Result 1",
          connectionId: "c1",
          sqlCell: { id: "cell-1", sql: "SELECT * FROM t", proposed_sql: null },
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

    const parsed = JSON.parse(String(await readResults.execute!({ offset: 1, limit: 1 }, { messages: [] } as never)));
    expect(parsed.batch.returned_rows).toBe(1);
    expect(parsed.batch.has_more).toBe(true);
    expect(parsed.rows[0].id).toBe(2);
  });

  it("returns query history with explicit and default limits", async () => {
    useAppStore.setState({
      queryHistory: Array.from({ length: 20 }, (_, index) => ({
        id: `q-${index}`,
        sql: `SELECT ${index}`,
        connectionId: "c1",
        connectionName: "Main DB",
        timestamp: 1_700_000_000_000 + index,
        rowCount: 1,
        executionTimeMs: 1,
        error: null,
      })),
    });

    expect(JSON.parse(String(await getQueryHistory.execute!({ limit: "1" }, { messages: [] } as never)))).toHaveLength(1);
    expect(JSON.parse(String(await getQueryHistory.execute!({}, { messages: [] } as never)))).toHaveLength(10);
  });

  it("flags dangerous, dialect-specific, and correctness SQL patterns", async () => {
    const deleteResult = JSON.parse(String(await lintSqlSafety.execute!({ sql: "DELETE FROM orders", dialect: "postgresql" })));
    expect(deleteResult.safe).toBe(false);
    expect(deleteResult.warnings.some((w: { code: string }) => w.code === "NON_READONLY_STATEMENT")).toBe(true);

    const mysqlResult = JSON.parse(
      String(await lintSqlSafety.execute!({ sql: "SELECT * FROM t WHERE name ILIKE '%a%'", dialect: "mysql" }))
    );
    expect(mysqlResult.warnings.some((w: { code: string }) => w.code === "POSTGRES_SPECIFIC_ILIKE")).toBe(true);

    const nullResult = JSON.parse(String(await lintSqlSafety.execute!({ sql: "SELECT * FROM t WHERE col = NULL", dialect: "postgresql" })));
    expect(nullResult.warnings.some((w: { code: string }) => w.code === "NULL_EQUALITY_COMPARISON")).toBe(true);
  });

  it("detects structural SQL mistakes without flagging comments and strings", async () => {
    const safeString = JSON.parse(
      String(await lintSqlSafety.execute!({ sql: "SELECT 'DELETE FROM orders' as msg -- drop table t", dialect: "postgresql" }))
    );
    expect(safeString.safe).toBe(true);

    const having = JSON.parse(
      String(await lintSqlSafety.execute!({ sql: "SELECT count(*) FROM t HAVING count(*) > 1", dialect: "postgresql" }))
    );
    expect(having.warnings.some((w: { code: string }) => w.code === "HAVING_WITHOUT_GROUP_BY")).toBe(true);

    const windowFn = JSON.parse(String(await lintSqlSafety.execute!({ sql: "SELECT row_number() FROM t", dialect: "postgresql" })));
    expect(windowFn.warnings.some((w: { code: string }) => w.code === "WINDOW_FUNCTION_WITHOUT_OVER")).toBe(true);
  });
});
