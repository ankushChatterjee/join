import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

const invokeMock: any = mock((..._args: any[]) => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let useAppStore: (typeof import("@/stores/appStore"))["useAppStore"];
let findJoinPath: (typeof import("./schemaTools"))["findJoinPath"];

beforeAll(async () => {
  ({ useAppStore } = await import("@/stores/appStore"));
  ({ findJoinPath } = await import("./schemaTools"));
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

describe("schema tools", () => {
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
    });
  });

  it("finds a join path via foreign keys", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_schemas") return Promise.resolve([{ name: "public" }]);
      if (cmd === "get_tables") {
        return Promise.resolve([
          { name: "orders", schema: "public" },
          { name: "customers", schema: "public" },
        ]);
      }
      if (cmd === "get_foreign_keys" && payload.table === "orders") {
        return Promise.resolve([
          {
            constraint_name: "orders_customer_id_fkey",
            column_name: "customer_id",
            foreign_table_schema: "public",
            foreign_table_name: "customers",
            foreign_column_name: "id",
          },
        ]);
      }
      if (cmd === "get_foreign_keys" && payload.table === "customers") {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const raw = await (findJoinPath as any).execute(
      {
        from_table: "orders",
        to_table: "customers",
      },
      {
        experimental_context: { executionContext: baseExecutionContext() },
      },
    );

    const parsed = JSON.parse(raw);
    expect(parsed.found).toBe(true);
    expect(parsed.hop_count).toBe(1);
    expect(parsed.sql_skeleton).toContain("JOIN public.customers");
  });

  it("returns a not-found response when no path exists", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_schemas") return Promise.resolve([{ name: "public" }]);
      if (cmd === "get_tables") {
        return Promise.resolve([
          { name: "orders", schema: "public" },
          { name: "payments", schema: "public" },
        ]);
      }
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (findJoinPath as any).execute(
      {
        from_table: "orders",
        to_table: "payments",
        max_hops: 2,
      },
      {
        experimental_context: { executionContext: baseExecutionContext() },
      },
    );

    const parsed = JSON.parse(raw);
    expect(parsed.found).toBe(false);
    expect(parsed.message).toContain("No foreign-key join path");
  });
});
