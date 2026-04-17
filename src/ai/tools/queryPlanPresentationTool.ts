import { tool } from "ai";
import { z } from "zod/v4";

const explainPlanNodeSchema = z.object({
  node_id: z.string(),
  node_type: z.string(),
  label: z.string(),
  depth: z.number(),
  relation_name: z.string().nullable(),
  index_name: z.string().nullable(),
  description: z.string().nullable(),
  metrics: z.object({
    startup_cost: z.number().nullable(),
    total_cost: z.number().nullable(),
    plan_rows: z.number().nullable(),
    plan_width: z.number().nullable(),
    actual_rows: z.number().nullable(),
    actual_total_time_ms: z.number().nullable(),
  }),
  warnings: z.array(z.string()),
  child_node_ids: z.array(z.string()),
});

const explainPlanPayloadSchema = z.object({
  plan_id: z.string(),
  query_sql: z.string(),
  dialect: z.enum(["postgresql", "mysql", "sqlite"]),
  safe_to_proceed: z.boolean(),
  estimated_cost: z.number().nullable(),
  warnings: z.array(z.string()),
  indexes_used: z.array(z.string()),
  explain_time_ms: z.number(),
  suggested_rule: z.string().optional(),
  summary: z.object({
    rootLabel: z.string().nullable(),
    estimatedCost: z.number().nullable(),
    warnings: z.array(z.string()),
    indexesUsed: z.array(z.string()),
    notableCharacteristics: z.array(z.string()),
    nodeCount: z.number(),
  }),
  normalized_plan: z.object({
    root_node_id: z.string().nullable(),
    ordered_node_ids: z.array(z.string()),
    max_depth: z.number(),
    nodes: z.record(z.string(), explainPlanNodeSchema),
  }),
  raw_plan: z.unknown(),
});

export const presentQueryPlan = tool({
  description:
    "Create a chat-ready query plan visualization artifact after explain_sql. Use this immediately after explain_sql so the user gets an embedded visual explanation with targeted annotations.",
  inputSchema: z.object({
    plan_id: z.string().describe("Plan id from explain_sql"),
    title: z.string().describe("Short user-facing title for the visualization"),
    summary: z.string().describe("One or two sentence overview of what matters most in the plan"),
    default_focus_node_id: z.string().nullable().describe("Node to focus initially in the expanded inspector"),
    annotations: z.array(
      z.object({
        node_id: z.string().describe("Referenced node id from the normalized plan"),
        title: z.string().describe("Short callout title"),
        explanation: z.string().describe("User-facing explanation for why this node matters"),
        severity: z.enum(["info", "warning", "critical"]),
        recommendation: z.string().nullable().optional(),
      })
    ),
    plan: explainPlanPayloadSchema.describe("The explain_sql payload to render in chat"),
  }),
  execute: async ({ plan_id, title, summary, default_focus_node_id, annotations, plan }) => {
    if (plan.plan_id !== plan_id) {
      return JSON.stringify(
        {
          error: `plan_id mismatch: expected ${plan.plan_id}, received ${plan_id}`,
        },
        null,
        2
      );
    }

    const nodeIds = new Set(plan.normalized_plan.ordered_node_ids);
    const invalidNode = annotations.find((annotation) => !nodeIds.has(annotation.node_id));
    if (invalidNode) {
      return JSON.stringify(
        {
          error: `Annotation references unknown node_id: ${invalidNode.node_id}`,
        },
        null,
        2
      );
    }

    if (default_focus_node_id && !nodeIds.has(default_focus_node_id)) {
      return JSON.stringify(
        {
          error: `default_focus_node_id references unknown node_id: ${default_focus_node_id}`,
        },
        null,
        2
      );
    }

    return JSON.stringify(
      {
        plan_id,
        title,
        summary,
        default_focus_node_id,
        annotations: annotations.map((annotation, index) => ({
          annotation_id: `${plan_id}-${annotation.node_id}-${index}`,
          ...annotation,
        })),
        plan,
        source: "agent",
      },
      null,
      2
    );
  },
});
