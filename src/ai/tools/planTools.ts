// ============================================================================
// AI Agent - Planning Tools (Vercel AI SDK)
// ============================================================================
//
// Implements the two-step Plan → SQL workflow:
//   1. plan_sql_query  — validate tables, auto-discover FK join paths
//   2. explain_sql     — run EXPLAIN and surface cost/scan warnings

import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import type { AgentContext } from "../agent";
import type { TableInfo, ForeignKeyInfo, SchemaInfo } from "@/stores/types";

// ---------------------------------------------------------------------------
// Connection helper
// ---------------------------------------------------------------------------

function resolveConnectionId(
  ctx?: AgentContext,
  requestedConnectionId?: string
): { connectionId: string } {
  const { activeConnectionId } = useAppStore.getState();
  const defaultConnectionId = ctx?.executionContext.targetConnectionId ?? activeConnectionId;
  const connectionId = requestedConnectionId ?? defaultConnectionId;
  if (!connectionId) {
    throw new Error("No resolved database connection");
  }
  return { connectionId };
}

// ---------------------------------------------------------------------------
// Table reference & BFS types (parallel to schemaTools.ts internals)
// ---------------------------------------------------------------------------

interface TableRef {
  schema: string;
  table: string;
}

interface JoinEdge {
  from: TableRef;
  to: TableRef;
  constraint: string;
  fromColumn: string;
  toColumn: string;
}

function parseTableRef(raw: string): TableRef {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot >= 0) {
    return { schema: trimmed.slice(0, dot).trim(), table: trimmed.slice(dot + 1).trim() };
  }
  return { schema: "", table: trimmed };
}

function tableKey(ref: TableRef): string {
  return `${ref.schema}.${ref.table}`;
}

// ---------------------------------------------------------------------------
// Build FK edge adjacency list for BFS
//
// Fetches all tables in the relevant schemas (same as find_join_path) so BFS
// can traverse intermediate tables even if the user didn't list them.
// ---------------------------------------------------------------------------

async function buildEdgeAdjacency(
  schemas: string[],
  connectionId: string
): Promise<Map<string, JoinEdge[]>> {
  const adjacency = new Map<string, JoinEdge[]>();

  const addEdge = (e: JoinEdge) => {
    const key = tableKey(e.from);
    const list = adjacency.get(key) ?? [];
    list.push(e);
    adjacency.set(key, list);
  };

  // Gather all tables across the relevant schemas
  const allTables: TableRef[] = [];
  for (const schema of schemas) {
    const tables = await invoke<TableInfo[]>("get_tables", { connectionId, schema });
    for (const t of tables) {
      allTables.push({ schema: t.schema || schema, table: t.name });
    }
  }

  // Fetch FK edges for every table (in parallel)
  await Promise.all(
    allTables.map(async (t) => {
      const fks = await invoke<ForeignKeyInfo[]>("get_foreign_keys", {
        connectionId,
        table: t.table,
        schema: t.schema,
      });
      for (const fk of fks) {
        const target: TableRef = {
          schema: fk.foreign_table_schema,
          table: fk.foreign_table_name,
        };
        addEdge({
          from: t,
          to: target,
          constraint: fk.constraint_name,
          fromColumn: fk.column_name,
          toColumn: fk.foreign_column_name,
        });
        addEdge({
          from: target,
          to: t,
          constraint: `${fk.constraint_name} (reverse)`,
          fromColumn: fk.foreign_column_name,
          toColumn: fk.column_name,
        });
      }
    })
  );

  return adjacency;
}

// BFS between two tables using the adjacency graph
function bfsPath(
  start: TableRef,
  goal: TableRef,
  adjacency: Map<string, JoinEdge[]>,
  maxHops = 4
): JoinEdge[] | null {
  const startKey = tableKey(start);
  const goalKey = tableKey(goal);
  if (startKey === goalKey) return [];

  const queue: Array<{ node: TableRef; path: JoinEdge[] }> = [{ node: start, path: [] }];
  const visited = new Set<string>([startKey]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const nodeKey = tableKey(current.node);
    if (nodeKey === goalKey) return current.path;
    if (current.path.length >= maxHops) continue;

    for (const edge of adjacency.get(nodeKey) ?? []) {
      const nextKey = tableKey(edge.to);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push({ node: edge.to, path: [...current.path, edge] });
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// plan_sql_query
// ---------------------------------------------------------------------------

export const planSqlQuery = tool({
  description:
    "ALWAYS call this first when writing a new SQL query. Validates that your planned tables exist in the database, then auto-discovers FK join paths between them. Returns validated table names and join conditions ready to use. If any tables are missing, correct them and retry before calling describe_table or writing any SQL.",
  inputSchema: z.object({
    goal: z.string().describe("What the SQL should accomplish in plain English"),
    tables: z
      .array(z.string())
      .describe(
        "Schema-qualified table names to query, e.g. ['public.orders', 'public.customers']. Always include the schema prefix."
      ),
    connection_id: z.string().optional().describe("Optional explicit connection ID"),
  }),
  execute: async ({ goal, tables }, { experimental_context }) => {
    const ctx = experimental_context as AgentContext | undefined;
    const { connectionId } = resolveConnectionId(ctx);

    if (tables.length === 0) {
      return JSON.stringify({ status: "error", error: "No tables provided." }, null, 2);
    }

    // --- 1. Parse references ---
    const parsed = tables.map(parseTableRef);

    // Catch unqualified names early
    const unqualified = parsed.filter((r) => !r.schema).map((r) => r.table);
    if (unqualified.length > 0) {
      return JSON.stringify(
        {
          status: "error",
          error:
            "Table names must include the schema prefix (e.g. public.orders). " +
            `Missing schema for: ${unqualified.join(", ")}. ` +
            "Use list_schemas and list_tables if unsure of the schema name.",
        },
        null,
        2
      );
    }

    // --- 2. Validate each table exists ---
    const missingTables: string[] = [];
    const validatedTables: TableRef[] = [];

    // Group by schema to minimise IPC calls
    const bySchema = new Map<string, TableRef[]>();
    for (const ref of parsed) {
      const list = bySchema.get(ref.schema) ?? [];
      list.push(ref);
      bySchema.set(ref.schema, list);
    }

    await Promise.all(
      Array.from(bySchema.entries()).map(async ([schema, refs]) => {
        const available = await invoke<TableInfo[]>("get_tables", { connectionId, schema });
        const availableNames = new Set(available.map((t) => t.name));
        for (const ref of refs) {
          if (availableNames.has(ref.table)) {
            validatedTables.push(ref);
          } else {
            missingTables.push(`${tableKey(ref)} (not found in schema "${schema}")`);
          }
        }
      })
    );

    if (missingTables.length > 0) {
      return JSON.stringify(
        {
          status: "error",
          error:
            "Some tables were not found. Correct the names and retry plan_sql_query.",
          missing_tables: missingTables,
          validated_tables: validatedTables.map(tableKey),
          hint: "Use list_tables to browse available tables in the schema.",
        },
        null,
        2
      );
    }

    // --- 3. Discover FK join paths (for multi-table queries) ---
    const joinPaths: Array<{
      from: string;
      to: string;
      found: boolean;
      conditions: string[];
      via_constraints: string[];
      sql_snippet: string;
    }> = [];

    if (validatedTables.length >= 2) {
      // Only fetch FKs for schemas that appear in the validated table list
      const relevantSchemas = Array.from(new Set(validatedTables.map((t) => t.schema)));

      // Fall back to all schemas when the graph needs cross-schema traversal
      let schemas = relevantSchemas;
      if (schemas.length === 0) {
        const allSchemas = await invoke<SchemaInfo[]>("get_schemas", { connectionId });
        schemas = allSchemas.map((s) => s.name);
      }

      const adjacency = await buildEdgeAdjacency(schemas, connectionId);

      // Assign short table aliases deterministically
      const aliases = new Map<string, string>();
      const aliasFor = (ref: TableRef): string => {
        const key = tableKey(ref);
        if (!aliases.has(key)) aliases.set(key, `t${aliases.size + 1}`);
        return aliases.get(key)!;
      };
      // Seed alias for the first table so it gets t1
      aliasFor(validatedTables[0]);

      // Find path from each table to the next in the list
      for (let i = 1; i < validatedTables.length; i++) {
        const from = validatedTables[i - 1];
        const to = validatedTables[i];
        const path = bfsPath(from, to, adjacency);

        if (!path) {
          joinPaths.push({
            from: tableKey(from),
            to: tableKey(to),
            found: false,
            conditions: [],
            via_constraints: [],
            sql_snippet: `-- No FK path found between ${tableKey(from)} and ${tableKey(to)}. Join condition must be specified manually.`,
          });
        } else {
          const conditions = path.map((e) => {
            const la = aliasFor(e.from);
            const ra = aliasFor(e.to);
            return `${la}.${e.fromColumn} = ${ra}.${e.toColumn}`;
          });
          const snippetLines = path.map((e) => {
            const la = aliasFor(e.from);
            const ra = aliasFor(e.to);
            return `JOIN ${tableKey(e.to)} ${ra} ON ${la}.${e.fromColumn} = ${ra}.${e.toColumn}`;
          });
          joinPaths.push({
            from: tableKey(from),
            to: tableKey(to),
            found: true,
            conditions,
            via_constraints: path.map((e) => e.constraint),
            sql_snippet: snippetLines.join("\n"),
          });
        }
      }
    }

    const allJoinsFound = joinPaths.length === 0 || joinPaths.every((j) => j.found);
    const validatedKeys = validatedTables.map(tableKey);

    const nextSteps: string[] = [
      `Call describe_table for each of: ${validatedKeys.join(", ")}`,
    ];
    if (joinPaths.length > 0 && allJoinsFound) {
      const joinSummary = joinPaths
        .filter((j) => j.found)
        .map((j) => `  ${j.from} → ${j.to}: ${j.conditions.join(", ")}`)
        .join("\n");
      nextSteps.push(`Use these FK join conditions (already verified):\n${joinSummary}`);
    } else if (joinPaths.some((j) => !j.found)) {
      nextSteps.push(
        "Some join paths were not found via FK — you will need to specify the join condition manually after describing the tables."
      );
    }
    nextSteps.push(
      "Draft SQL using ONLY column names confirmed by describe_table",
      "Run lint_sql_safety on the draft SQL",
      "Run explain_sql before writing to the editor"
    );

    return JSON.stringify(
      {
        status: "ready",
        goal,
        validated_tables: validatedKeys,
        all_join_paths_found: allJoinsFound,
        join_paths: joinPaths,
        next_steps: nextSteps,
      },
      null,
      2
    );
  },
});

// ---------------------------------------------------------------------------
// explain_sql
// ---------------------------------------------------------------------------

export const explainSql = tool({
  description:
    "Run EXPLAIN on a SQL query to check its execution plan — estimated cost, index usage, and whether full-table scans are present. Call this after lint_sql_safety and before writing SQL to the editor with insert_sql or replace_editor_content. Does not require user approval.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL query to analyze with EXPLAIN"),
    connection_id: z.string().optional().describe("Optional explicit connection ID"),
  }),
  execute: async ({ sql }, { experimental_context }) => {
    const ctx = experimental_context as AgentContext | undefined;
    const { connectionId } = resolveConnectionId(ctx);

    const { connections } = useAppStore.getState();
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection?.is_connected) {
      return JSON.stringify(
        { safe_to_proceed: false, error: `Database not connected for connection ${connectionId}` },
        null,
        2
      );
    }

    const dialect =
      ctx?.executionContext.targetConnectionDialect ?? connection.db_type ?? "postgresql";

    let explainQuery: string;
    if (dialect === "postgresql") {
      explainQuery = `EXPLAIN (FORMAT JSON, ANALYZE false) ${sql}`;
    } else if (dialect === "mysql") {
      explainQuery = `EXPLAIN FORMAT=JSON ${sql}`;
    } else {
      // sqlite fallback
      explainQuery = `EXPLAIN QUERY PLAN ${sql}`;
    }

    let result: {
      columns: { name: string }[];
      rows: unknown[][];
      execution_time_ms: number;
    };
    try {
      result = await invoke("execute_query", { connectionId, sql: explainQuery });
    } catch (err) {
      return JSON.stringify(
        {
          safe_to_proceed: false,
          error: `EXPLAIN failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        null,
        2
      );
    }

    const warnings: string[] = [];
    const indexesUsed: string[] = [];
    let estimatedCost: number | null = null;

    if (dialect === "postgresql") {
      try {
        const rawValue = result.rows[0]?.[0];
        const jsonStr = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
        const plan = JSON.parse(jsonStr);
        const rootPlan = Array.isArray(plan) ? plan[0]?.Plan : plan?.Plan;

        const walk = (node: Record<string, unknown>) => {
          if (!node || typeof node !== "object") return;
          const nodeType = node["Node Type"] as string | undefined;
          const relation = node["Relation Name"] as string | undefined;

          if (nodeType === "Seq Scan" && relation) {
            warnings.push(
              `Sequential scan on "${relation}" — consider an index if this table is large`
            );
          }
          if (nodeType?.includes("Index") && node["Index Name"]) {
            indexesUsed.push(node["Index Name"] as string);
          }

          for (const val of Object.values(node)) {
            if (Array.isArray(val)) {
              for (const child of val) {
                if (child && typeof child === "object") walk(child as Record<string, unknown>);
              }
            } else if (val && typeof val === "object") {
              walk(val as Record<string, unknown>);
            }
          }
        };

        if (rootPlan) {
          estimatedCost = typeof rootPlan["Total Cost"] === "number" ? rootPlan["Total Cost"] : null;
          walk(rootPlan);
        }
      } catch {
        warnings.push("Could not parse EXPLAIN JSON output — review manually");
      }
    } else if (dialect === "mysql") {
      try {
        const rawValue = result.rows[0]?.[0];
        const jsonStr = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
        const plan = JSON.parse(jsonStr);

        const walk = (node: Record<string, unknown>) => {
          if (!node || typeof node !== "object") return;
          const accessType = node["access_type"] as string | undefined;
          const tableName = node["table_name"] as string | undefined;
          if (accessType === "ALL" && tableName) {
            warnings.push(`Full table scan on "${tableName}" — consider adding an index`);
          }
          for (const val of Object.values(node)) {
            if (val && typeof val === "object") walk(val as Record<string, unknown>);
          }
        };
        walk(plan);
      } catch {
        warnings.push("Could not parse EXPLAIN JSON output — review manually");
      }
    } else {
      // SQLite: EXPLAIN QUERY PLAN returns rows with a "detail" column
      const detailIdx = result.columns.findIndex(
        (c) => c.name.toLowerCase() === "detail"
      );
      if (detailIdx >= 0) {
        for (const row of result.rows) {
          const detail = String(row[detailIdx] ?? "");
          if (/\bSCAN\b/i.test(detail)) {
            warnings.push(`Full scan detected: "${detail}"`);
          } else if (/\bSEARCH\b/i.test(detail)) {
            const idxMatch = detail.match(/USING\s+(?:INDEX\s+)?(\S+)/i);
            if (idxMatch) indexesUsed.push(idxMatch[1]);
          }
        }
      }
    }

    return JSON.stringify(
      {
        safe_to_proceed: warnings.length === 0,
        estimated_cost: estimatedCost,
        warnings,
        indexes_used: indexesUsed,
        dialect,
        explain_time_ms: result.execution_time_ms,
      },
      null,
      2
    );
  },
});
