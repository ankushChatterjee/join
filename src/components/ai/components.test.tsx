import { describe, expect, it, mock } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));

mock.module("@/components/editor/editorUtils", () => ({
  getSelectedText: () => "",
  getFullEditorContent: () => "",
  getCursorPosition: () => null,
  getEditorView: () => null,
  insertTextAtCursor: () => undefined,
}));

const { ChatMessageComponent } = await import("./ChatMessage");
const { QueryPlanCard } = await import("./QueryPlanCard");

function presentation() {
  return {
    plan_id: "plan-1",
    title: "Postgres query plan",
    summary: "Sequential scan may be expensive",
    default_focus_node_id: "node-1",
    source: "fallback" as const,
    annotations: [
      {
        annotation_id: "a1",
        node_id: "node-1",
        title: "Seq Scan",
        explanation: "The query scans the users table.",
        severity: "warning" as const,
        recommendation: "Add a selective predicate or index.",
      },
    ],
    plan: {
      plan_id: "plan-1",
      query_sql: "SELECT * FROM users",
      dialect: "postgresql" as const,
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
        root_node_id: "node-1",
        ordered_node_ids: ["node-1"],
        max_depth: 0,
        nodes: {
          "node-1": {
            node_id: "node-1",
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
    },
  };
}

describe("AI components server rendering", () => {
  it("renders user, assistant, error, and pending approval messages", () => {
    const userMarkup = renderToStaticMarkup(
      createElement(ChatMessageComponent, {
        message: { id: "m1", role: "user", content: "How many users?", timestamp: 1 },
      })
    );
    expect(userMarkup).toContain("How many users?");
    expect(userMarkup).toContain("Resend");

    const assistantMarkup = renderToStaticMarkup(
      createElement(ChatMessageComponent, {
        message: { id: "m2", role: "assistant", content: "Use `SELECT count(*)`.", timestamp: 2 },
      })
    );
    expect(assistantMarkup).toContain("SELECT count(*)");

    const errorMarkup = renderToStaticMarkup(
      createElement(ChatMessageComponent, {
        message: { id: "m3", role: "assistant", content: "Backend failed", timestamp: 3, isError: true },
      })
    );
    expect(errorMarkup).toContain("Something went wrong");
    expect(errorMarkup).toContain("Backend failed");

    const approvalMarkup = renderToStaticMarkup(
      createElement(ChatMessageComponent, {
        message: { id: "m4", role: "assistant", content: "", timestamp: 4 },
        pendingApprovals: [
          { toolCallId: "tool-1", toolName: "execute_readonly_sql", sql: "SELECT 1", resolve: () => undefined },
        ],
      })
    );
    expect(approvalMarkup).toContain("Approve");
    expect(approvalMarkup).toContain("SELECT 1");
  });

  it("renders query plan cards with summary, nodes, and recommendations", () => {
    const markup = renderToStaticMarkup(createElement(QueryPlanCard, { presentation: presentation() }));
    expect(markup).toContain("Postgres query plan");
    expect(markup).toContain("Sequential scan may be expensive");
    expect(markup).toContain("Seq Scan on users");
    expect(markup).toContain("The query scans the users table.");
  });
});
