import { beforeEach, describe, expect, it, mock } from "bun:test";

type InvokeCall = { cmd: string; payload: Record<string, unknown> };
const invokeCalls: InvokeCall[] = [];
let invokeImpl: (cmd: string, payload: Record<string, unknown>) => unknown | Promise<unknown> =
  () => undefined;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload: Record<string, unknown>) => {
    invokeCalls.push({ cmd, payload });
    return invokeImpl(cmd, payload);
  },
}));

const { useAppStore } = await import("@/stores/appStore");
const { openSqlInSheetTool } = await import("./editorTools");

const connection = {
  id: "c1",
  name: "Main DB",
  db_type: "postgresql" as const,
  host: "localhost",
  port: 5432,
  database: "join_test",
  username: "join",
  ssl_mode: "disable",
  is_connected: true,
};

function resetStore() {
  invokeCalls.length = 0;
  invokeImpl = (cmd) => {
    if (cmd === "create_script") {
      return {
        id: "script-1",
        name: "Main DB_1",
        connection_id: "c1",
        created_at: 1,
        updated_at: 1,
        version: 1,
        selected_cell_id: "cell-1",
        cells: [
          {
            id: "cell-1",
            sql: "",
            last_run_at: null,
            last_run_duration_ms: null,
            last_run_successful: null,
            proposed_sql: null,
          },
        ],
      };
    }
    return undefined;
  };
  useAppStore.setState({
    activeProject: {
      id: "p1",
      name: "Project",
      rootPath: "/tmp/project",
      createdAt: 1,
      updatedAt: 1,
    },
    activeConnectionId: "c1",
    connections: [connection],
    scriptsByConnection: { c1: [] },
    openScripts: [],
    activeScriptId: null,
    activeEditorTab: null,
    openResultTabs: [],
  });
}

describe("AI editor tools", () => {
  beforeEach(resetStore);

  it("asks approval before opening codebase SQL in a new sheet", async () => {
    const result = await openSqlInSheetTool.execute!(
      {
        sql: "SELECT * FROM orders",
        source: "src/modules/orders.repository.ts:130",
        sheet_name: "Checkout SQL",
      },
      {
        toolCallId: "tool-1",
        messages: [],
        experimental_context: {
          onRequestApproval: ({ sql, resolve }: { sql: string; resolve: (approved: boolean) => void }) => {
            expect(sql).toContain("-- Source: src/modules/orders.repository.ts:130");
            expect(sql).toContain("SELECT * FROM orders");
            resolve(true);
          },
        },
      } as never
    );

    expect(String(result)).toContain("new sheet");
    const script = useAppStore.getState().openScripts[0];
    expect(script.cells[0].sql).toContain("-- Found by codebase chat lookup");
    expect(script.cells[0].sql).toContain("SELECT * FROM orders");
    expect(invokeCalls.some((call) => call.cmd === "create_script")).toBe(true);
  });

  it("adds a new cell to the active sheet when one is open", async () => {
    await useAppStore.getState().createScript("c1");
    invokeCalls.length = 0;

    const result = await openSqlInSheetTool.execute!(
      { sql: "SELECT 1", source: "src/db/example.ts:10" },
      {
        toolCallId: "tool-2",
        messages: [],
        experimental_context: {
          onRequestApproval: ({ resolve }: { resolve: (approved: boolean) => void }) => resolve(true),
        },
      } as never
    );

    expect(String(result)).toContain("new cell");
    const script = useAppStore.getState().openScripts[0];
    expect(script.cells).toHaveLength(2);
    expect(script.cells[1].sql).toContain("SELECT 1");
    expect(invokeCalls.some((call) => call.cmd === "create_script")).toBe(false);
  });
});
