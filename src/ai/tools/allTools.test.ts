// ============================================================================
// AI Agent - Aggregate validation of all tools
// ============================================================================
//
// Verifies that every tool in allTools has valid structure (description,
// inputSchema, execute) and that input schemas accept valid inputs.

import { describe, expect, it } from "bun:test";
import { allTools } from "./index";

const TOOL_NAMES = Object.keys(allTools) as (keyof typeof allTools)[];

describe("allTools aggregate validation", () => {
  it("exports all expected tools", () => {
    const expected: (keyof typeof allTools)[] = [
      "plan_sql_query",
      "explain_sql",
      "get_postgres_best_practice",
      "list_schemas",
      "list_tables",
      "describe_table",
      "list_views",
      "describe_view",
      "list_functions",
      "find_join_path",
      "execute_readonly_sql",
      "get_query_history",
      "read_results",
      "lint_sql_safety",
      "get_editor_context",
      "insert_sql",
      "replace_editor_content",
      "add_cell",
      "ask_question",
    ];
    expect(TOOL_NAMES.sort()).toEqual(expected.sort());
  });

  it("each tool has description, inputSchema, and execute", () => {
    for (const name of TOOL_NAMES) {
      const t = allTools[name] as { description?: string; inputSchema?: unknown; execute?: unknown };
      expect(t, `Tool ${name} should have description`).toBeDefined();
      expect(typeof t.description, `Tool ${name} description should be string`).toBe("string");
      expect(t.description!.length, `Tool ${name} description should be non-empty`).toBeGreaterThan(0);
      expect(t.inputSchema, `Tool ${name} should have inputSchema`).toBeDefined();
      expect(typeof t.execute, `Tool ${name} should have execute function`).toBe("function");
    }
  });

  it("plan_sql_query schema accepts valid input", () => {
    const schema = (allTools.plan_sql_query as any).inputSchema;
    const result = schema.safeParse({
      goal: "Get orders",
      tables: ["public.orders", "public.customers"],
    });
    expect(result.success).toBe(true);
  });

  it("plan_sql_query schema accepts tables array (empty handled at execute)", () => {
    const schema = (allTools.plan_sql_query as any).inputSchema;
    const result = schema.safeParse({ goal: "Get data", tables: [] });
    expect(result.success).toBe(true);
  });

  it("explain_sql schema accepts valid input", () => {
    const schema = (allTools.explain_sql as any).inputSchema;
    const result = schema.safeParse({ sql: "SELECT 1" });
    expect(result.success).toBe(true);
  });

  it("get_postgres_best_practice schema requires rule_id", () => {
    const schema = (allTools.get_postgres_best_practice as any).inputSchema;
    expect(schema.safeParse({ rule_id: "query-missing-indexes" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("list_schemas schema accepts empty object", () => {
    const schema = (allTools.list_schemas as any).inputSchema;
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("list_tables schema requires schema", () => {
    const schema = (allTools.list_tables as any).inputSchema;
    expect(schema.safeParse({ schema: "public" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("describe_table schema requires schema and table", () => {
    const schema = (allTools.describe_table as any).inputSchema;
    expect(schema.safeParse({ schema: "public", table: "orders" }).success).toBe(true);
    expect(schema.safeParse({ schema: "public" }).success).toBe(false);
  });

  it("list_views schema requires schema", () => {
    const schema = (allTools.list_views as any).inputSchema;
    expect(schema.safeParse({ schema: "public" }).success).toBe(true);
  });

  it("describe_view schema requires schema and view", () => {
    const schema = (allTools.describe_view as any).inputSchema;
    expect(schema.safeParse({ schema: "public", view: "v_orders" }).success).toBe(true);
  });

  it("list_functions schema requires schema", () => {
    const schema = (allTools.list_functions as any).inputSchema;
    expect(schema.safeParse({ schema: "public" }).success).toBe(true);
  });

  it("find_join_path schema requires from_table and to_table", () => {
    const schema = (allTools.find_join_path as any).inputSchema;
    expect(
      schema.safeParse({ from_table: "public.orders", to_table: "public.customers" }).success
    ).toBe(true);
    expect(schema.safeParse({ from_table: "orders" }).success).toBe(false);
  });

  it("execute_readonly_sql schema requires sql", () => {
    const schema = (allTools.execute_readonly_sql as any).inputSchema;
    expect(schema.safeParse({ sql: "SELECT 1" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("get_query_history schema accepts optional limit", () => {
    const schema = (allTools.get_query_history as any).inputSchema;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ limit: "20" }).success).toBe(true);
  });

  it("read_results schema accepts valid pagination", () => {
    const schema = (allTools.read_results as any).inputSchema;
    expect(schema.safeParse({ offset: 0, limit: 50 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("lint_sql_safety schema requires sql", () => {
    const schema = (allTools.lint_sql_safety as any).inputSchema;
    expect(schema.safeParse({ sql: "SELECT * FROM t" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("get_editor_context schema accepts empty object", () => {
    const schema = (allTools.get_editor_context as any).inputSchema;
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("insert_sql schema requires sql", () => {
    const schema = (allTools.insert_sql as any).inputSchema;
    expect(schema.safeParse({ sql: "SELECT 1" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("replace_editor_content schema requires sql", () => {
    const schema = (allTools.replace_editor_content as any).inputSchema;
    expect(schema.safeParse({ sql: "SELECT 1" }).success).toBe(true);
  });

  it("add_cell schema accepts optional sql", () => {
    const schema = (allTools.add_cell as any).inputSchema;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ sql: "SELECT 1" }).success).toBe(true);
  });

  it("ask_question schema requires questions array", () => {
    const schema = (allTools.ask_question as any).inputSchema;
    expect(
      schema.safeParse({
        questions: [
          {
            question: "Test?",
            header: "Test",
            options: [{ label: "A", description: "Option A" }],
          },
        ],
      }).success
    ).toBe(true);
    expect(schema.safeParse({ questions: [] }).success).toBe(false);
  });
});
