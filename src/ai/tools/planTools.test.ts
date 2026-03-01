import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

const invokeMock: any = mock((..._args: any[]) => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let useAppStore: (typeof import("@/stores/appStore"))["useAppStore"];
let planSqlQuery: (typeof import("./planTools"))["planSqlQuery"];
let explainSql: (typeof import("./planTools"))["explainSql"];

beforeAll(async () => {
  ({ useAppStore } = await import("@/stores/appStore"));
  ({ planSqlQuery, explainSql } = await import("./planTools"));
});

function baseExecutionContext(dialect: string = "postgresql") {
  return {
    runId: "run-1",
    sessionId: "session-1",
    targetConnectionId: "c1",
    targetConnectionDialect: dialect,
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

function baseAgentContext(dialect: string = "postgresql") {
  return { executionContext: baseExecutionContext(dialect) };
}

function connected(dialect: "postgresql" | "mysql" | "sqlite" = "postgresql") {
  return {
    id: "c1",
    name: "Main DB",
    db_type: dialect,
    host: "localhost",
    port: 5432,
    database: "testdb",
    username: "test",
    ssl_mode: "disable",
    is_connected: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers — common invoke implementations
// ---------------------------------------------------------------------------

/** Standard two-table schema: public.orders FK→ public.customers */
function ordersCustomersInvoke(cmd: string, payload: any) {
  if (cmd === "get_tables" && payload.schema === "public") {
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
  if (cmd === "get_foreign_keys") return Promise.resolve([]);
  return Promise.resolve([]);
}

// ---------------------------------------------------------------------------
// plan_sql_query
// ---------------------------------------------------------------------------

describe("plan_sql_query", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({
      activeConnectionId: "c1",
      connections: [connected()],
    });
  });

  it("returns error when table names have no schema prefix", async () => {
    const raw = await (planSqlQuery as any).execute(
      { goal: "Get orders", tables: ["orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("schema prefix");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns error when a table does not exist in the schema", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([{ name: "customers", schema: "public" }]);
      }
      return Promise.resolve([]);
    });

    const raw = await (planSqlQuery as any).execute(
      { goal: "Get orders", tables: ["public.orders", "public.customers"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(parsed.missing_tables.some((s: string) => s.includes("public.orders"))).toBe(true);
    expect(parsed.validated_tables).toContain("public.customers");
  });

  it("returns error for empty tables list", async () => {
    const raw = await (planSqlQuery as any).execute(
      { goal: "Get something", tables: [] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("validates a single table and returns ready status", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([{ name: "customers", schema: "public" }]);
      }
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planSqlQuery as any).execute(
      { goal: "Get all customers", tables: ["public.customers"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("ready");
    expect(parsed.validated_tables).toEqual(["public.customers"]);
    expect(parsed.join_paths).toHaveLength(0);
    expect(parsed.all_join_paths_found).toBe(true);
    expect(parsed.next_steps[0]).toContain("public.customers");
  });

  it("discovers a direct FK join path between two tables", async () => {
    invokeMock.mockImplementation(ordersCustomersInvoke);

    const raw = await (planSqlQuery as any).execute(
      { goal: "Orders with customer names", tables: ["public.orders", "public.customers"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("ready");
    expect(parsed.validated_tables).toEqual(["public.orders", "public.customers"]);
    expect(parsed.all_join_paths_found).toBe(true);
    expect(parsed.join_paths).toHaveLength(1);

    const jp = parsed.join_paths[0];
    expect(jp.found).toBe(true);
    expect(jp.from).toBe("public.orders");
    expect(jp.to).toBe("public.customers");
    expect(jp.conditions[0]).toContain("customer_id");
    expect(jp.sql_snippet).toContain("JOIN public.customers");
  });

  it("reports unfound join paths when no FK relationship exists", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([
          { name: "orders", schema: "public" },
          { name: "audit_log", schema: "public" },
        ]);
      }
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planSqlQuery as any).execute(
      { goal: "Orders with audit", tables: ["public.orders", "public.audit_log"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("ready");
    expect(parsed.all_join_paths_found).toBe(false);
    expect(parsed.join_paths[0].found).toBe(false);
    expect(parsed.join_paths[0].sql_snippet).toContain("No FK path found");
  });

  it("discovers a multi-hop join path through an intermediate table", async () => {
    // orders → order_items → products (2-hop)
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([
          { name: "orders", schema: "public" },
          { name: "order_items", schema: "public" },
          { name: "products", schema: "public" },
        ]);
      }
      if (cmd === "get_foreign_keys" && payload.table === "orders") {
        return Promise.resolve([]);
      }
      if (cmd === "get_foreign_keys" && payload.table === "order_items") {
        return Promise.resolve([
          {
            constraint_name: "order_items_order_id_fkey",
            column_name: "order_id",
            foreign_table_schema: "public",
            foreign_table_name: "orders",
            foreign_column_name: "id",
          },
          {
            constraint_name: "order_items_product_id_fkey",
            column_name: "product_id",
            foreign_table_schema: "public",
            foreign_table_name: "products",
            foreign_column_name: "id",
          },
        ]);
      }
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planSqlQuery as any).execute(
      { goal: "Products in orders", tables: ["public.orders", "public.products"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("ready");
    expect(parsed.all_join_paths_found).toBe(true);
    const jp = parsed.join_paths[0];
    expect(jp.found).toBe(true);
    expect(jp.sql_snippet).toContain("order_items");
  });

  it("next_steps always includes describe_table instruction", async () => {
    invokeMock.mockImplementation(ordersCustomersInvoke);

    const raw = await (planSqlQuery as any).execute(
      { goal: "Orders with customer names", tables: ["public.orders", "public.customers"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.next_steps[0]).toContain("describe_table");
    expect(parsed.next_steps[0]).toContain("public.orders");
    expect(parsed.next_steps[0]).toContain("public.customers");
  });

  it("next_steps includes lint and explain reminders", async () => {
    invokeMock.mockImplementation(ordersCustomersInvoke);

    const raw = await (planSqlQuery as any).execute(
      { goal: "Orders with customer names", tables: ["public.orders", "public.customers"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);
    const allSteps = parsed.next_steps.join(" ");

    expect(allSteps).toContain("lint_sql_safety");
    expect(allSteps).toContain("explain_sql");
  });

  it("uses the default connection when no connection_id is provided", async () => {
    invokeMock.mockImplementation(ordersCustomersInvoke);

    await (planSqlQuery as any).execute(
      { goal: "Orders", tables: ["public.orders", "public.customers"] },
      { experimental_context: { executionContext: { ...baseExecutionContext(), targetConnectionId: null } } }
    );

    // Should use the store's activeConnectionId (c1) — get_tables should be called
    const tablesCalls = invokeMock.mock.calls.filter(([cmd]: [string]) => cmd === "get_tables");
    expect(tablesCalls.length).toBeGreaterThan(0);
  });

  it("handles tables across multiple schemas", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([{ name: "orders", schema: "public" }]);
      }
      if (cmd === "get_tables" && payload.schema === "billing") {
        return Promise.resolve([{ name: "invoices", schema: "billing" }]);
      }
      if (cmd === "get_foreign_keys" && payload.table === "orders") {
        return Promise.resolve([
          {
            constraint_name: "orders_invoice_id_fkey",
            column_name: "invoice_id",
            foreign_table_schema: "billing",
            foreign_table_name: "invoices",
            foreign_column_name: "id",
          },
        ]);
      }
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planSqlQuery as any).execute(
      { goal: "Orders with invoices", tables: ["public.orders", "billing.invoices"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("ready");
    expect(parsed.validated_tables).toContain("public.orders");
    expect(parsed.validated_tables).toContain("billing.invoices");
  });
});

// ---------------------------------------------------------------------------
// explain_sql
// ---------------------------------------------------------------------------

describe("explain_sql", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({
      activeConnectionId: "c1",
      connections: [connected()],
    });
  });

  it("returns error when database is not connected", async () => {
    useAppStore.setState({
      connections: [{ ...connected(), is_connected: false }],
    });

    const raw = await (explainSql as any).execute(
      { sql: "SELECT 1" },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(false);
    expect(parsed.error).toContain("not connected");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns error gracefully when EXPLAIN execution fails", async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error("syntax error")));

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM nonexistent" },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(false);
    expect(parsed.error).toContain("syntax error");
  });

  // --- PostgreSQL ---

  it("postgres: issues the correct EXPLAIN format", async () => {
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "QUERY PLAN" }],
        rows: [['[{"Plan":{"Node Type":"Seq Scan","Relation Name":"orders","Total Cost":100,"Startup Cost":0}}]']],
        execution_time_ms: 2,
      })
    );

    await (explainSql as any).execute(
      { sql: "SELECT * FROM orders" },
      { experimental_context: baseAgentContext("postgresql") }
    );

    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.sql).toContain("EXPLAIN");
    expect(payload.sql).toContain("FORMAT JSON");
    expect(payload.sql).toContain("ANALYZE false");
  });

  it("postgres: detects sequential scan and sets safe_to_proceed false", async () => {
    const plan = [
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Relation Name": "orders",
          "Total Cost": 9999.5,
          "Startup Cost": 0,
        },
      },
    ];
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "QUERY PLAN" }],
        rows: [[JSON.stringify(plan)]],
        execution_time_ms: 3,
      })
    );

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM orders" },
      { experimental_context: baseAgentContext("postgresql") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(false);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.warnings[0]).toContain("orders");
    expect(parsed.estimated_cost).toBe(9999.5);
  });

  it("postgres: reports safe_to_proceed true when only indexes are used", async () => {
    const plan = [
      {
        Plan: {
          "Node Type": "Index Scan",
          "Index Name": "orders_customer_id_idx",
          "Relation Name": "orders",
          "Total Cost": 8.3,
          "Startup Cost": 0.3,
        },
      },
    ];
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "QUERY PLAN" }],
        rows: [[JSON.stringify(plan)]],
        execution_time_ms: 1,
      })
    );

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM orders WHERE customer_id = 1" },
      { experimental_context: baseAgentContext("postgresql") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(true);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.indexes_used).toContain("orders_customer_id_idx");
  });

  it("postgres: walks nested plan nodes to find deep sequential scans", async () => {
    const plan = [
      {
        Plan: {
          "Node Type": "Hash Join",
          "Total Cost": 500,
          Plans: [
            {
              "Node Type": "Seq Scan",
              "Relation Name": "order_items",
              "Total Cost": 200,
            },
            {
              "Node Type": "Hash",
              "Total Cost": 300,
              Plans: [
                {
                  "Node Type": "Index Scan",
                  "Index Name": "products_pkey",
                  "Total Cost": 10,
                },
              ],
            },
          ],
        },
      },
    ];
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "QUERY PLAN" }],
        rows: [[JSON.stringify(plan)]],
        execution_time_ms: 5,
      })
    );

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM order_items JOIN products ON order_items.product_id = products.id" },
      { experimental_context: baseAgentContext("postgresql") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(false);
    expect(parsed.warnings.some((w: string) => w.includes("order_items"))).toBe(true);
    expect(parsed.indexes_used).toContain("products_pkey");
  });

  it("postgres: handles malformed EXPLAIN JSON gracefully", async () => {
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "QUERY PLAN" }],
        rows: [["not valid json {{{"]],
        execution_time_ms: 1,
      })
    );

    const raw = await (explainSql as any).execute(
      { sql: "SELECT 1" },
      { experimental_context: baseAgentContext("postgresql") }
    );
    const parsed = JSON.parse(raw);

    // Should not throw — warns about parse failure instead
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.warnings[0]).toContain("parse");
  });

  // --- MySQL ---

  it("mysql: issues the correct EXPLAIN format", async () => {
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "EXPLAIN" }],
        rows: [['{"query_block":{}}']],
        execution_time_ms: 1,
      })
    );

    useAppStore.setState({ connections: [connected("mysql")] });

    await (explainSql as any).execute(
      { sql: "SELECT * FROM orders" },
      { experimental_context: baseAgentContext("mysql") }
    );

    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.sql).toContain("EXPLAIN FORMAT=JSON");
  });

  it("mysql: detects full table scan via access_type ALL", async () => {
    const plan = {
      query_block: {
        table: {
          table_name: "orders",
          access_type: "ALL",
        },
      },
    };
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "EXPLAIN" }],
        rows: [[JSON.stringify(plan)]],
        execution_time_ms: 2,
      })
    );

    useAppStore.setState({ connections: [connected("mysql")] });

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM orders" },
      { experimental_context: baseAgentContext("mysql") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(false);
    expect(parsed.warnings[0]).toContain("orders");
  });

  it("mysql: safe_to_proceed true when no full scan", async () => {
    const plan = {
      query_block: {
        table: {
          table_name: "orders",
          access_type: "ref",
          key: "orders_customer_id_idx",
        },
      },
    };
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "EXPLAIN" }],
        rows: [[JSON.stringify(plan)]],
        execution_time_ms: 1,
      })
    );

    useAppStore.setState({ connections: [connected("mysql")] });

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM orders WHERE customer_id = 5" },
      { experimental_context: baseAgentContext("mysql") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(true);
    expect(parsed.warnings).toHaveLength(0);
  });

  // --- SQLite ---

  it("sqlite: issues EXPLAIN QUERY PLAN", async () => {
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "id" }, { name: "parent" }, { name: "notused" }, { name: "detail" }],
        rows: [[1, 0, 0, "SEARCH orders USING INDEX orders_status_idx (status=?)"]],
        execution_time_ms: 1,
      })
    );

    useAppStore.setState({ connections: [connected("sqlite")] });

    await (explainSql as any).execute(
      { sql: "SELECT * FROM orders WHERE status = 'paid'" },
      { experimental_context: baseAgentContext("sqlite") }
    );

    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.sql).toContain("EXPLAIN QUERY PLAN");
  });

  it("sqlite: detects full SCAN and sets safe_to_proceed false", async () => {
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "id" }, { name: "parent" }, { name: "notused" }, { name: "detail" }],
        rows: [[1, 0, 0, "SCAN orders"]],
        execution_time_ms: 1,
      })
    );

    useAppStore.setState({ connections: [connected("sqlite")] });

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM orders" },
      { experimental_context: baseAgentContext("sqlite") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(false);
    expect(parsed.warnings[0]).toContain("SCAN orders");
  });

  it("sqlite: reports index usage from SEARCH rows", async () => {
    invokeMock.mockImplementation(() =>
      Promise.resolve({
        columns: [{ name: "id" }, { name: "parent" }, { name: "notused" }, { name: "detail" }],
        rows: [
          [1, 0, 0, "SEARCH orders USING INDEX orders_customer_id_idx (customer_id=?)"],
        ],
        execution_time_ms: 1,
      })
    );

    useAppStore.setState({ connections: [connected("sqlite")] });

    const raw = await (explainSql as any).execute(
      { sql: "SELECT * FROM orders WHERE customer_id = 1" },
      { experimental_context: baseAgentContext("sqlite") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.safe_to_proceed).toBe(true);
    expect(parsed.indexes_used).toContain("orders_customer_id_idx");
  });
});
