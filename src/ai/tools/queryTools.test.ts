import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock: any = vi.fn((..._args: any[]) => undefined);
vi.mock("@tauri-apps/api/core", () => ({
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
      dialect: "postgresql",
    });
    const parsed = JSON.parse(raw);
    const highWarnings = parsed.warnings.filter((w: { severity: string }) => w.severity === "high");

    expect(parsed.safe).toBe(false);
    expect(highWarnings.length).toBeGreaterThan(0);
  });

  it("lint_sql_safety handles dialect-specific checks", async () => {
    // ILIKE is PG-only
    const pgRes = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t WHERE name ILIKE '%a%'",
      dialect: "postgresql",
    });
    expect(JSON.parse(pgRes).safe).toBe(true);

    const mysqlRes = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t WHERE name ILIKE '%a%'",
      dialect: "mysql",
    });
    const parsedMysql = JSON.parse(mysqlRes);
    expect(parsedMysql.safe).toBe(false);
    expect(parsedMysql.warnings.some((w: any) => w.code === "POSTGRES_SPECIFIC_ILIKE")).toBe(true);
  });

  it("lint_sql_safety ignores keywords in comments and strings", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT 'DELETE FROM orders' as msg -- drop table t",
      dialect: "postgresql",
    });
    expect(JSON.parse(res).safe).toBe(true);
  });

  it("lint_sql_safety detects NULL equality mistakes", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t WHERE col = NULL",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.safe).toBe(false);
    expect(parsed.warnings.some((w: any) => w.code === "NULL_EQUALITY_COMPARISON")).toBe(true);
  });

  it("lint_sql_safety detects HAVING without GROUP BY via AST", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT count(*) FROM t HAVING count(*) > 1",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.safe).toBe(false);
    expect(parsed.warnings.some((w: any) => w.code === "HAVING_WITHOUT_GROUP_BY")).toBe(true);
  });

  it("lint_sql_safety detects window function without OVER via AST", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT row_number() FROM t",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.safe).toBe(false);
    expect(parsed.warnings.some((w: any) => w.code === "WINDOW_FUNCTION_WITHOUT_OVER")).toBe(true);
  });

  it("lint_sql_safety detects aggregates in WHERE clause", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t WHERE COUNT(*) > 1",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.warnings.some((w: any) => w.code === "AGGREGATE_IN_WHERE")).toBe(true);
  });

  it("lint_sql_safety detects MySQL-specific syntax in PostgreSQL", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT `id`, IFNULL(name, 'N/A'), GROUP_CONCAT(tags) FROM t",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.warnings.some((w: any) => w.code === "MYSQL_SPECIFIC_IDENTIFIER")).toBe(true);
    expect(parsed.warnings.some((w: any) => w.code === "MYSQL_SPECIFIC_IFNULL")).toBe(true);
    expect(parsed.warnings.some((w: any) => w.code === "MYSQL_SPECIFIC_GROUP_CONCAT")).toBe(true);
  });

  it("lint_sql_safety detects unsupported joins in MySQL and SQLite", async () => {
    const mysqlRes = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t1 FULL OUTER JOIN t2 ON t1.id = t2.id",
      dialect: "mysql",
    });
    expect(JSON.parse(mysqlRes).warnings.some((w: any) => w.code === "MYSQL_MISSING_FULL_JOIN")).toBe(
      true,
    );

    const sqliteRes = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t1 RIGHT JOIN t2 ON t1.id = t2.id",
      dialect: "sqlite",
    });
    expect(
      JSON.parse(sqliteRes).warnings.some((w: any) => w.code === "SQLITE_MISSING_RIGHT_FULL_JOIN"),
    ).toBe(true);
  });

  it("lint_sql_safety detects Cartesian joins correctly and avoids false positives", async () => {
    // False positive case: ON DELETE in preceding text
    const fpRes = await (lintSqlSafety as any).execute({
      sql: "INSERT INTO t (id) VALUES (1) ON CONFLICT DO NOTHING",
      dialect: "postgresql",
    });
    expect(JSON.parse(fpRes).warnings.some((w: any) => w.code === "POSSIBLE_CARTESIAN_JOIN")).toBe(
      false,
    );

    // Actual Cartesian join
    const cartesianRes = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t1 JOIN t2",
      dialect: "postgresql",
    });
    expect(
      JSON.parse(cartesianRes).warnings.some((w: any) => w.code === "POSSIBLE_CARTESIAN_JOIN"),
    ).toBe(true);
  });

  it("lint_sql_safety detects SELECT * and UNBOUNDED_SCAN", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM large_table",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.warnings.some((w: any) => w.code === "SELECT_STAR")).toBe(true);
    expect(parsed.warnings.some((w: any) => w.code === "UNBOUNDED_SCAN")).toBe(true);
  });

  it("lint_sql_safety detects ORDER BY without LIMIT", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT name FROM t ORDER BY name",
      dialect: "postgresql",
    });
    expect(JSON.parse(res).warnings.some((w: any) => w.code === "ORDER_BY_WITHOUT_LIMIT")).toBe(
      true,
    );
  });

  it("lint_sql_safety handles multiple statements", async () => {
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT count(*) FROM t HAVING count(*) > 1; SELECT row_number() FROM t;",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.warnings.some((w: any) => w.code === "HAVING_WITHOUT_GROUP_BY")).toBe(true);
    expect(parsed.warnings.some((w: any) => w.code === "WINDOW_FUNCTION_WITHOUT_OVER")).toBe(true);
  });

  it("lint_sql_safety falls back gracefully on parser failure", async () => {
    // Very complex or invalid syntax that might break the parser but should still trigger regex checks
    const res = await (lintSqlSafety as any).execute({
      sql: "SELECT * FROM t WHERE col = NULL; SOME INVALID SYNTAX THAT PARSER HATES",
      dialect: "postgresql",
    });
    const parsed = JSON.parse(res);
    expect(parsed.warnings.some((w: any) => w.code === "NULL_EQUALITY_COMPARISON")).toBe(true);
  });
});
