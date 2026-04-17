import { describe, expect, it } from "bun:test";
import {
  deriveFallbackPlanPresentation,
  getQueryPlanPresentationForToolCall,
  normalizeExplainPlan,
  parseExplainPlanPayloadFromResult,
  safeJsonParse,
} from "./queryPlan";
import type { ExplainPlanPayload } from "./types";

function planPayload(): ExplainPlanPayload {
  return {
    plan_id: "plan-1",
    query_sql: "SELECT * FROM users",
    dialect: "postgresql",
    generated_explain_sql: "EXPLAIN SELECT * FROM users",
    safe_to_proceed: false,
    summary: {
      rootLabel: "Seq Scan on users",
      estimatedCost: 10,
      warnings: ["Sequential scan may be expensive"],
      indexesUsed: [],
      notableCharacteristics: ["Full table scan"],
      nodeCount: 1,
    },
    normalized_plan: {
      root_node_id: "seq-scan-1",
      ordered_node_ids: ["seq-scan-1"],
      max_depth: 0,
      nodes: {
        "seq-scan-1": {
          node_id: "seq-scan-1",
          node_type: "Seq Scan",
          label: "Seq Scan on users",
          depth: 0,
          relation_name: "users",
          index_name: null,
          description: null,
          metrics: {
            startup_cost: 0,
            total_cost: 10,
            plan_rows: 1000,
            plan_width: 32,
            actual_rows: null,
            actual_total_time_ms: null,
          },
          warnings: ["Sequential scan may be expensive"],
          child_node_ids: [],
        },
      },
    },
    raw_plan: [],
    warnings: ["Sequential scan may be expensive"],
  };
}

describe("query plan parsing and presentation", () => {
  it("parses safe JSON and rejects malformed payloads", () => {
    expect(safeJsonParse('{"ok":true}')).toEqual({ ok: true });
    expect(safeJsonParse("not json")).toBeNull();
    expect(parseExplainPlanPayloadFromResult(JSON.stringify(planPayload()))?.plan_id).toBe("plan-1");
    expect(parseExplainPlanPayloadFromResult(JSON.stringify({ plan_id: "missing-fields" }))).toBeNull();
  });

  it("derives a fallback presentation from explain payload warnings", () => {
    const presentation = deriveFallbackPlanPresentation(planPayload());
    expect(presentation.source).toBe("fallback");
    expect(presentation.annotations).toHaveLength(1);
    expect(presentation.annotations[0].severity).toBe("warning");
    expect(presentation.default_focus_node_id).toBe("seq-scan-1");
  });

  it("extracts presentations from completed tool calls only", () => {
    const presentation = getQueryPlanPresentationForToolCall({
      id: "tool-1",
      name: "explain_sql",
      input: {},
      status: "completed",
      result: JSON.stringify(planPayload()),
    });
    expect(presentation?.plan_id).toBe("plan-1");
    expect(
      getQueryPlanPresentationForToolCall({
        id: "tool-2",
        name: "explain_sql",
        input: {},
        status: "running",
        result: JSON.stringify(planPayload()),
      })
    ).toBeNull();
  });

  it("normalizes PostgreSQL, MySQL, and SQLite explain output into tree data", () => {
    const pg = normalizeExplainPlan(
      "postgresql",
      {
        columns: [{ name: "QUERY PLAN" }],
        rows: [[JSON.stringify([{ Plan: { "Node Type": "Seq Scan", "Relation Name": "users", "Total Cost": 12 } }])]],
        execution_time_ms: 1,
      },
      []
    );
    expect(pg.normalizedPlan.root_node_id).not.toBeNull();
    expect(pg.normalizedPlan.ordered_node_ids.length).toBeGreaterThan(0);

    const mysql = normalizeExplainPlan(
      "mysql",
      {
        columns: [{ name: "EXPLAIN" }],
        rows: [[JSON.stringify({ query_block: { table: { table_name: "users", access_type: "ALL", rows_examined_per_scan: 10 } } })]],
        execution_time_ms: 1,
      },
      []
    );
    expect(mysql.normalizedPlan.ordered_node_ids.length).toBeGreaterThan(0);

    const sqlite = normalizeExplainPlan(
      "sqlite",
      {
        columns: [{ name: "id" }, { name: "parent" }, { name: "notused" }, { name: "detail" }],
        rows: [[0, 0, 0, "SCAN users"]],
        execution_time_ms: 1,
      },
      []
    );
    expect(sqlite.normalizedPlan.nodes[sqlite.normalizedPlan.root_node_id ?? ""]?.description).toBe("SCAN users");
  });
});
