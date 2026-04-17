import type {
  ExplainPlanNode,
  ExplainPlanPayload,
  ExplainPlanPresentation,
  ExplainPlanSummary,
  ExplainPlanTree,
  QueryPlanAnnotation,
  ToolCallDisplay,
} from "./types";

interface ExplainQueryResult {
  columns: { name: string }[];
  rows: unknown[][];
  execution_time_ms: number;
}

type Dialect = ExplainPlanPayload["dialect"];

function slugifyNodeType(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "node";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function createSummary(
  rootLabel: string | null,
  estimatedCost: number | null,
  warnings: string[],
  indexesUsed: string[],
  notableCharacteristics: string[],
  nodeCount: number
): ExplainPlanSummary {
  return {
    rootLabel,
    estimatedCost,
    warnings,
    indexesUsed,
    notableCharacteristics,
    nodeCount,
  };
}

export function safeJsonParse(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function isExplainPlanPayload(value: unknown): value is ExplainPlanPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExplainPlanPayload>;
  return (
    typeof candidate.plan_id === "string" &&
    typeof candidate.query_sql === "string" &&
    typeof candidate.dialect === "string" &&
    !!candidate.summary &&
    !!candidate.normalized_plan
  );
}

export function isExplainPlanPresentation(value: unknown): value is ExplainPlanPresentation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExplainPlanPresentation>;
  return (
    typeof candidate.plan_id === "string" &&
    typeof candidate.title === "string" &&
    !!candidate.plan &&
    Array.isArray(candidate.annotations)
  );
}

export function parseExplainPlanPayloadFromResult(result?: string): ExplainPlanPayload | null {
  const parsed = safeJsonParse(result);
  return isExplainPlanPayload(parsed) ? parsed : null;
}

export function parseExplainPlanPresentationFromResult(
  result?: string
): ExplainPlanPresentation | null {
  const parsed = safeJsonParse(result);
  return isExplainPlanPresentation(parsed) ? parsed : null;
}

export function deriveFallbackPlanPresentation(
  plan: ExplainPlanPayload
): ExplainPlanPresentation {
  const annotations: QueryPlanAnnotation[] = [];
  const orderedIds = plan.normalized_plan.ordered_node_ids;
  for (const nodeId of orderedIds) {
    const node = plan.normalized_plan.nodes[nodeId];
    if (!node) continue;
    for (const warning of node.warnings) {
      annotations.push({
        annotation_id: `${plan.plan_id}-${nodeId}-${annotations.length}`,
        node_id: nodeId,
        title: node.label,
        explanation: warning,
        severity: warning.toLowerCase().includes("scan") ? "warning" : "info",
        recommendation:
          warning.toLowerCase().includes("scan")
            ? "Check whether a supporting index or a more selective predicate would reduce the scan."
            : null,
      });
      if (annotations.length >= 4) break;
    }
    if (annotations.length >= 4) break;
  }

  if (annotations.length === 0 && orderedIds.length > 0) {
    const focusNode = plan.normalized_plan.nodes[orderedIds[0]];
    if (focusNode) {
      annotations.push({
        annotation_id: `${plan.plan_id}-${focusNode.node_id}-overview`,
        node_id: focusNode.node_id,
        title: focusNode.label,
        explanation:
          plan.summary.rootLabel != null
            ? `This is the root operation for the plan. Follow its children to see how rows are produced.`
            : `This node is the main operation in the current plan.`,
        severity: "info",
        recommendation: null,
      });
    }
  }

  return {
    plan_id: plan.plan_id,
    title: `${plan.dialect === "postgresql" ? "Postgres" : plan.dialect} query plan`,
    summary:
      plan.summary.warnings[0] ??
      (plan.safe_to_proceed
        ? "Plan looks healthy enough to proceed."
        : "Plan needs review before proceeding."),
    default_focus_node_id: plan.normalized_plan.root_node_id,
    annotations,
    plan,
    source: "fallback",
  };
}

export function getQueryPlanPresentationForToolCall(
  toolCall: ToolCallDisplay
): ExplainPlanPresentation | null {
  if (toolCall.isError || toolCall.status !== "completed") return null;
  if (toolCall.name === "present_query_plan") {
    return parseExplainPlanPresentationFromResult(toolCall.result);
  }
  if (toolCall.name === "explain_sql") {
    const payload = parseExplainPlanPayloadFromResult(toolCall.result);
    return payload ? deriveFallbackPlanPresentation(payload) : null;
  }
  return null;
}

function createEmptyTree(): ExplainPlanTree {
  return {
    root_node_id: null,
    ordered_node_ids: [],
    max_depth: 0,
    nodes: {},
  };
}

function createNodeBase(
  nodeId: string,
  nodeType: string,
  label: string,
  depth: number
): ExplainPlanNode {
  return {
    node_id: nodeId,
    node_type: nodeType,
    label,
    depth,
    relation_name: null,
    index_name: null,
    description: null,
    metrics: {
      startup_cost: null,
      total_cost: null,
      plan_rows: null,
      plan_width: null,
      actual_rows: null,
      actual_total_time_ms: null,
    },
    warnings: [],
    child_node_ids: [],
  };
}

export function normalizeExplainPlan(
  dialect: Dialect,
  result: ExplainQueryResult,
  warnings: string[]
): { normalizedPlan: ExplainPlanTree; rawPlan: unknown } {
  if (dialect === "postgresql") {
    const rawValue = result.rows[0]?.[0];
    const jsonStr = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
    const rawPlan = JSON.parse(jsonStr);
    return {
      normalizedPlan: normalizePostgresPlan(rawPlan, warnings),
      rawPlan,
    };
  }

  if (dialect === "mysql") {
    const rawValue = result.rows[0]?.[0];
    const jsonStr = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
    const rawPlan = JSON.parse(jsonStr);
    return {
      normalizedPlan: normalizeMysqlPlan(rawPlan, warnings),
      rawPlan,
    };
  }

  const rawPlan = result.rows.map((row) =>
    result.columns.reduce<Record<string, unknown>>((acc, column, index) => {
      acc[column.name] = row[index];
      return acc;
    }, {})
  );
  return {
    normalizedPlan: normalizeSqlitePlan(rawPlan, warnings),
    rawPlan,
  };
}

function normalizePostgresPlan(rawPlan: unknown, warnings: string[]): ExplainPlanTree {
  const tree = createEmptyTree();
  const planRoot = Array.isArray(rawPlan)
    ? (rawPlan[0] as Record<string, unknown> | undefined)?.Plan
    : (rawPlan as Record<string, unknown> | undefined)?.Plan;
  if (!planRoot || typeof planRoot !== "object") return tree;

  let nodeCounter = 0;
  const walk = (node: Record<string, unknown>, depth: number): string => {
    const nodeType = asString(node["Node Type"]) ?? "Plan Node";
    const relationName = asString(node["Relation Name"]);
    const indexName = asString(node["Index Name"]);
    const label = relationName ? `${nodeType} · ${relationName}` : nodeType;
    const nodeId = `pg-${slugifyNodeType(nodeType)}-${nodeCounter++}`;
    const normalized = createNodeBase(nodeId, nodeType, label, depth);
    normalized.relation_name = relationName;
    normalized.index_name = indexName;
    normalized.description =
      asString(node["Join Type"]) ??
      asString(node["Strategy"]) ??
      asString(node["Parent Relationship"]);
    normalized.metrics = {
      startup_cost: asNumber(node["Startup Cost"]),
      total_cost: asNumber(node["Total Cost"]),
      plan_rows: asNumber(node["Plan Rows"]),
      plan_width: asNumber(node["Plan Width"]),
      actual_rows: asNumber(node["Actual Rows"]),
      actual_total_time_ms: asNumber(node["Actual Total Time"]),
    };
    normalized.warnings = warnings.filter((warning) =>
      relationName ? warning.includes(`"${relationName}"`) : false
    );
    tree.nodes[nodeId] = normalized;
    tree.ordered_node_ids.push(nodeId);
    tree.max_depth = Math.max(tree.max_depth, depth);

    const childIds: string[] = [];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object" && "Node Type" in (child as Record<string, unknown>)) {
            childIds.push(walk(child as Record<string, unknown>, depth + 1));
          }
        }
      }
    }
    normalized.child_node_ids = childIds;
    return nodeId;
  };

  tree.root_node_id = walk(planRoot as Record<string, unknown>, 0);
  return tree;
}

function normalizeMysqlPlan(rawPlan: unknown, warnings: string[]): ExplainPlanTree {
  const tree = createEmptyTree();
  if (!rawPlan || typeof rawPlan !== "object") return tree;
  let nodeCounter = 0;

  const shouldCreateNode = (key: string, value: Record<string, unknown>): boolean =>
    key === "query_block" ||
    key === "table" ||
    key === "nested_loop" ||
    key === "grouping_operation" ||
    key === "ordering_operation" ||
    typeof value["table_name"] === "string" ||
    typeof value["access_type"] === "string";

  const walk = (
    value: unknown,
    depth: number,
    parentId: string | null,
    keyHint = "query_block"
  ): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth, parentId, keyHint);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    let currentParentId = parentId;

    if (shouldCreateNode(keyHint, record)) {
      const nodeType =
        asString(record.access_type) ??
        asString(record.select_type) ??
        keyHint.replace(/_/g, " ");
      const tableName = asString(record.table_name);
      const label = tableName ? `${nodeType} · ${tableName}` : nodeType;
      const nodeId = `mysql-${slugifyNodeType(nodeType)}-${nodeCounter++}`;
      const normalized = createNodeBase(nodeId, nodeType, label, depth);
      normalized.relation_name = tableName;
      normalized.index_name = asString(record.key);
      normalized.description = asString(record.used_key_parts) ?? asString(record.access_type);
      normalized.metrics = {
        startup_cost: null,
        total_cost: asNumber(record.query_cost),
        plan_rows: asNumber(record.rows_examined_per_scan) ?? asNumber(record.rows_produced_per_join),
        plan_width: null,
        actual_rows: null,
        actual_total_time_ms: null,
      };
      normalized.warnings = warnings.filter((warning) =>
        tableName ? warning.includes(`"${tableName}"`) : false
      );
      tree.nodes[nodeId] = normalized;
      tree.ordered_node_ids.push(nodeId);
      tree.max_depth = Math.max(tree.max_depth, depth);
      if (!tree.root_node_id) tree.root_node_id = nodeId;
      if (parentId) {
        tree.nodes[parentId]?.child_node_ids.push(nodeId);
      }
      currentParentId = nodeId;
    }

    for (const [key, child] of Object.entries(record)) {
      if (child && typeof child === "object") {
        walk(child, currentParentId === parentId ? depth : depth + 1, currentParentId, key);
      }
    }
  };

  walk(rawPlan, 0, null);
  return tree;
}

function normalizeSqlitePlan(rawPlan: unknown, warnings: string[]): ExplainPlanTree {
  const tree = createEmptyTree();
  if (!Array.isArray(rawPlan)) return tree;

  const rows = rawPlan as Array<Record<string, unknown>>;
  for (const row of rows) {
    const detail = asString(row.detail) ?? "Plan step";
    const nodeType = detail.split(/\s+/).slice(0, 2).join(" ");
    const id = typeof row.id === "number" ? row.id : Number(row.id ?? 0);
    const parent = typeof row.parent === "number" ? row.parent : Number(row.parent ?? -1);
    const nodeId = `sqlite-${id}`;
    const normalized = createNodeBase(nodeId, nodeType || "Plan Step", detail, parent < 0 ? 0 : 1);
    normalized.description = detail;
    normalized.index_name = detail.match(/USING\s+(?:COVERING\s+)?INDEX\s+(\S+)/i)?.[1] ?? null;
    normalized.relation_name = detail.match(/\b(?:SCAN|SEARCH)\s+(\S+)/i)?.[1] ?? null;
    normalized.warnings = warnings.filter((warning) => warning.includes(detail));
    tree.nodes[nodeId] = normalized;
    tree.ordered_node_ids.push(nodeId);
    tree.max_depth = Math.max(tree.max_depth, normalized.depth);
    if (parent <= 0 || !rows.some((candidate) => Number(candidate.id ?? -1) === parent)) {
      tree.root_node_id ??= nodeId;
    } else {
      const parentId = `sqlite-${parent}`;
      tree.nodes[parentId]?.child_node_ids.push(nodeId);
    }
  }

  if (!tree.root_node_id && tree.ordered_node_ids.length > 0) {
    tree.root_node_id = tree.ordered_node_ids[0];
  }

  return tree;
}

export function buildExplainPayload(params: {
  dialect: Dialect;
  sql: string;
  safeToProceed: boolean;
  estimatedCost: number | null;
  warnings: string[];
  indexesUsed: string[];
  explainTimeMs: number;
  suggestedRule?: string;
  normalizedPlan: ExplainPlanTree;
  rawPlan: unknown;
}): ExplainPlanPayload {
  const notableCharacteristics: string[] = [];
  if (params.warnings.length > 0) notableCharacteristics.push("scan-warning");
  if (params.indexesUsed.length > 0) notableCharacteristics.push("uses-index");
  if (params.normalizedPlan.max_depth >= 3) notableCharacteristics.push("deep-plan");

  const rootNode =
    params.normalizedPlan.root_node_id != null
      ? params.normalizedPlan.nodes[params.normalizedPlan.root_node_id]
      : null;

  return {
    plan_id: crypto.randomUUID(),
    query_sql: params.sql,
    dialect: params.dialect,
    safe_to_proceed: params.safeToProceed,
    estimated_cost: params.estimatedCost,
    warnings: params.warnings,
    indexes_used: params.indexesUsed,
    explain_time_ms: params.explainTimeMs,
    suggested_rule: params.suggestedRule,
    summary: createSummary(
      rootNode?.label ?? null,
      params.estimatedCost,
      params.warnings,
      params.indexesUsed,
      notableCharacteristics,
      params.normalizedPlan.ordered_node_ids.length
    ),
    normalized_plan: params.normalizedPlan,
    raw_plan: params.rawPlan,
  };
}
