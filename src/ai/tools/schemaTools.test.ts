import { beforeEach, describe, expect, it, mock } from "bun:test";

const invokeCalls: Array<{ cmd: string; payload: Record<string, unknown> }> = [];
let invokeImpl: (cmd: string, payload: Record<string, unknown>) => unknown | Promise<unknown> = () => [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload: Record<string, unknown>) => {
    invokeCalls.push({ cmd, payload });
    return invokeImpl(cmd, payload);
  },
}));

const { useAppStore } = await import("@/stores/appStore");
const { findJoinPath, listSchemas } = await import("./schemaTools");

function context() {
  return {
    executionContext: {
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
    },
  };
}

describe("AI schema tools", () => {
  beforeEach(() => {
    invokeCalls.length = 0;
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
      metadataByConnection: {},
    });
  });

  it("lists schemas for the resolved connection", async () => {
    invokeImpl = async () => [{ name: "public" }, { name: "analytics" }];
    const result = JSON.parse(String(await listSchemas.execute!({}, { messages: [], experimental_context: context() } as never)));

    expect(result.connection_id).toBe("c1");
    expect(result.schemas).toEqual(["public", "analytics"]);
    expect(invokeCalls[0]).toEqual({ cmd: "get_schemas", payload: { connectionId: "c1" } });
  });

  it("finds a direct foreign-key join path", async () => {
    invokeImpl = async (cmd, payload) => {
      if (cmd === "get_tables") {
        expect(payload.schema).toBe("public");
        return [
          { name: "orders", schema: "public" },
          { name: "customers", schema: "public" },
        ];
      }
      if (cmd === "get_foreign_keys") {
        if (payload.table === "orders") {
          return [
            {
              constraint_name: "orders_customer_id_fkey",
              column_name: "customer_id",
              foreign_table_schema: "public",
              foreign_table_name: "customers",
              foreign_column_name: "id",
            },
          ];
        }
        return [];
      }
      return [];
    };

    const result = JSON.parse(
      String(
        await findJoinPath.execute!(
          { from_table: "orders", to_table: "customers", schema: "public" },
          { messages: [], experimental_context: context() } as never
        )
      )
    );

    expect(result.found).toBe(true);
    expect(result.hops).toHaveLength(1);
    expect(result.hops[0].join_condition).toBe("t1.customer_id = t2.id");
    expect(result.sql_skeleton).toContain("JOIN public.customers t2 ON t1.customer_id = t2.id");
  });

  it("reports ambiguous table names instead of guessing", async () => {
    invokeImpl = async (cmd) => {
      if (cmd === "get_schemas") return [{ name: "public" }, { name: "archive" }];
      if (cmd === "get_tables") {
        return [
          { name: "orders", schema: "public" },
          { name: "orders", schema: "archive" },
          { name: "customers", schema: "public" },
        ];
      }
      return [];
    };

    const result = JSON.parse(
      String(
        await findJoinPath.execute!(
          { from_table: "orders", to_table: "customers" },
          { messages: [], experimental_context: context() } as never
        )
      )
    );
    expect(result.error).toContain("Unable to resolve");
    expect(result.from_error).toContain("Ambiguous");
  });
});
