// ============================================================================
// AI Agent - Schema Exploration Tools (Vercel AI SDK)
// ============================================================================

import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import type {
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  ViewInfo,
  IndexInfo,
  ForeignKeyInfo,
  FunctionInfo,
} from "@/stores/types";

function getConnectionId(): string {
  const { activeConnectionId } = useAppStore.getState();
  if (!activeConnectionId) {
    throw new Error("No active database connection");
  }
  return activeConnectionId;
}

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

function parseTableRef(tableRef: string, fallbackSchema?: string): TableRef {
  const trimmed = tableRef.trim();
  if (trimmed.includes(".")) {
    const [schema, ...rest] = trimmed.split(".");
    return {
      schema: schema.trim(),
      table: rest.join(".").trim(),
    };
  }
  return {
    schema: fallbackSchema || "",
    table: trimmed,
  };
}

function tableKey(ref: TableRef): string {
  return `${ref.schema}.${ref.table}`;
}

// --- list_schemas ---
export const listSchemas = tool({
  description:
    "List all schemas in the currently connected database. Returns schema names.",
  inputSchema: z.object({}),
  execute: async () => {
    const connectionId = getConnectionId();
    const schemas = await invoke<SchemaInfo[]>("get_schemas", { connectionId });
    return JSON.stringify(
      schemas.map((s) => s.name),
      null,
      2
    );
  },
});

// --- find_join_path ---
export const findJoinPath = tool({
  description:
    "Find likely foreign-key join paths between two tables. Useful when constructing JOIN queries across multiple tables.",
  inputSchema: z.object({
    from_table: z.string().describe("Starting table, optionally schema-qualified (e.g. public.orders)"),
    to_table: z.string().describe("Target table, optionally schema-qualified (e.g. public.customers)"),
    schema: z
      .string()
      .optional()
      .describe("Default schema for unqualified table names"),
    max_hops: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe("Maximum joins to traverse (default 4, max 6)"),
  }),
  execute: async ({ from_table, to_table, schema, max_hops }) => {
    const connectionId = getConnectionId();
    const hopLimit = max_hops ?? 4;

    const schemas = schema
      ? [schema]
      : (await invoke<SchemaInfo[]>("get_schemas", { connectionId })).map((s) => s.name);

    const allTables: TableRef[] = [];
    for (const schemaName of schemas) {
      const tables = await invoke<TableInfo[]>("get_tables", {
        connectionId,
        schema: schemaName,
      });
      for (const table of tables) {
        allTables.push({
          schema: table.schema || schemaName,
          table: table.name,
        });
      }
    }

    if (allTables.length === 0) {
      return JSON.stringify({ error: "No tables available for join path analysis." }, null, 2);
    }

    const resolveTable = (input: string): { ref?: TableRef; error?: string } => {
      const parsed = parseTableRef(input, schema);
      if (parsed.schema) {
        const exact = allTables.find((t) => t.schema === parsed.schema && t.table === parsed.table);
        if (!exact) {
          return { error: `Table not found: ${parsed.schema}.${parsed.table}` };
        }
        return { ref: exact };
      }

      const matches = allTables.filter((t) => t.table === parsed.table);
      if (matches.length === 1) {
        return { ref: matches[0] };
      }
      if (matches.length === 0) {
        return { error: `Table not found: ${parsed.table}` };
      }

      const preferred = schema ? matches.find((m) => m.schema === schema) : null;
      if (preferred) return { ref: preferred };

      return {
        error:
          `Ambiguous table name "${parsed.table}". Matches: ` +
          matches.map((m) => `${m.schema}.${m.table}`).join(", "),
      };
    };

    const fromResolved = resolveTable(from_table);
    const toResolved = resolveTable(to_table);
    if (!fromResolved.ref || !toResolved.ref) {
      return JSON.stringify(
        {
          error: "Unable to resolve table references.",
          from_error: fromResolved.error,
          to_error: toResolved.error,
        },
        null,
        2
      );
    }

    const edges: JoinEdge[] = [];
    for (const table of allTables) {
      const foreignKeys = await invoke<ForeignKeyInfo[]>("get_foreign_keys", {
        connectionId,
        table: table.table,
        schema: table.schema,
      });

      for (const fk of foreignKeys) {
        const target: TableRef = {
          schema: fk.foreign_table_schema,
          table: fk.foreign_table_name,
        };
        edges.push({
          from: table,
          to: target,
          constraint: fk.constraint_name,
          fromColumn: fk.column_name,
          toColumn: fk.foreign_column_name,
        });
        edges.push({
          from: target,
          to: table,
          constraint: `${fk.constraint_name} (reverse)`,
          fromColumn: fk.foreign_column_name,
          toColumn: fk.column_name,
        });
      }
    }

    const start = fromResolved.ref;
    const goal = toResolved.ref;
    const startKey = tableKey(start);
    const goalKey = tableKey(goal);
    const adjacency = new Map<string, JoinEdge[]>();
    for (const edge of edges) {
      const key = tableKey(edge.from);
      const list = adjacency.get(key) || [];
      list.push(edge);
      adjacency.set(key, list);
    }

    const queue: Array<{ node: TableRef; path: JoinEdge[] }> = [{ node: start, path: [] }];
    const visited = new Set<string>([startKey]);
    let foundPath: JoinEdge[] | null = null;

    while (queue.length > 0) {
      const current = queue.shift()!;
      const nodeKey = tableKey(current.node);
      if (nodeKey === goalKey) {
        foundPath = current.path;
        break;
      }
      if (current.path.length >= hopLimit) {
        continue;
      }

      const nextEdges = adjacency.get(nodeKey) || [];
      for (const edge of nextEdges) {
        const nextKey = tableKey(edge.to);
        if (visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push({
          node: edge.to,
          path: [...current.path, edge],
        });
      }
    }

    if (!foundPath) {
      return JSON.stringify(
        {
          from: startKey,
          to: goalKey,
          max_hops: hopLimit,
          found: false,
          message: "No foreign-key join path found within the hop limit.",
        },
        null,
        2
      );
    }

    const aliases = new Map<string, string>();
    const aliasFor = (ref: TableRef): string => {
      const key = tableKey(ref);
      const existing = aliases.get(key);
      if (existing) return existing;
      const next = `t${aliases.size + 1}`;
      aliases.set(key, next);
      return next;
    };

    aliasFor(start);
    const hops = foundPath.map((edge) => {
      const fromAlias = aliasFor(edge.from);
      const toAlias = aliasFor(edge.to);
      return {
        from: tableKey(edge.from),
        to: tableKey(edge.to),
        constraint: edge.constraint,
        join_condition: `${fromAlias}.${edge.fromColumn} = ${toAlias}.${edge.toColumn}`,
      };
    });

    const fromAlias = aliasFor(start);
    const joinClauses = foundPath
      .map((edge) => {
        const left = aliasFor(edge.from);
        const right = aliasFor(edge.to);
        return `JOIN ${edge.to.schema}.${edge.to.table} ${right} ON ${left}.${edge.fromColumn} = ${right}.${edge.toColumn}`;
      })
      .join("\n");

    const sqlSkeleton = `SELECT ${fromAlias}.*\nFROM ${start.schema}.${start.table} ${fromAlias}\n${joinClauses}`;

    return JSON.stringify(
      {
        from: startKey,
        to: goalKey,
        found: true,
        hop_count: foundPath.length,
        hops,
        sql_skeleton: sqlSkeleton,
      },
      null,
      2
    );
  },
});

// --- list_tables ---
export const listTables = tool({
  description:
    "List all tables in a specific schema. Returns table names.",
  inputSchema: z.object({
    schema: z.string().describe("The schema name to list tables from"),
  }),
  execute: async ({ schema }) => {
    const connectionId = getConnectionId();
    const tables = await invoke<TableInfo[]>("get_tables", {
      connectionId,
      schema,
    });
    return JSON.stringify(
      tables.map((t) => t.name),
      null,
      2
    );
  },
});

// --- describe_table ---
export const describeTable = tool({
  description:
    "Get detailed information about a table including columns, data types, primary keys, indexes, and foreign keys.",
  inputSchema: z.object({
    schema: z.string().describe("The schema name"),
    table: z.string().describe("The table name"),
  }),
  execute: async ({ schema, table }) => {
    const connectionId = getConnectionId();

    const [columns, indexes, foreignKeys] = await Promise.all([
      invoke<ColumnInfo[]>("get_columns", {
        connectionId,
        table,
        schema,
      }),
      invoke<IndexInfo[]>("get_indexes", {
        connectionId,
        table,
        schema,
      }),
      invoke<ForeignKeyInfo[]>("get_foreign_keys", {
        connectionId,
        table,
        schema,
      }),
    ]);

    return JSON.stringify(
      {
        table: `${schema}.${table}`,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.data_type,
          nullable: c.is_nullable,
          primaryKey: c.is_primary_key,
        })),
        indexes: indexes.map((i) => ({
          name: i.name,
          unique: i.is_unique,
          primary: i.is_primary,
        })),
        foreignKeys: foreignKeys.map((fk) => ({
          constraint: fk.constraint_name,
          column: fk.column_name,
          references: `${fk.foreign_table_schema}.${fk.foreign_table_name}(${fk.foreign_column_name})`,
        })),
      },
      null,
      2
    );
  },
});

// --- list_views ---
export const listViews = tool({
  description: "List all views in a specific schema.",
  inputSchema: z.object({
    schema: z.string().describe("The schema name to list views from"),
  }),
  execute: async ({ schema }) => {
    const connectionId = getConnectionId();
    const views = await invoke<ViewInfo[]>("get_views", {
      connectionId,
      schema,
    });
    return JSON.stringify(
      views.map((v) => v.name),
      null,
      2
    );
  },
});

// --- describe_view ---
export const describeView = tool({
  description:
    "Get the columns and their types for a specific view.",
  inputSchema: z.object({
    schema: z.string().describe("The schema name"),
    view: z.string().describe("The view name"),
  }),
  execute: async ({ schema, view }) => {
    const connectionId = getConnectionId();

    const columns = await invoke<ColumnInfo[]>("get_columns", {
      connectionId,
      table: view,
      schema,
    });

    return JSON.stringify(
      {
        view: `${schema}.${view}`,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.data_type,
          nullable: c.is_nullable,
        })),
      },
      null,
      2
    );
  },
});

// --- list_functions ---
export const listFunctions = tool({
  description: "List all functions/stored procedures in a specific schema.",
  inputSchema: z.object({
    schema: z.string().describe("The schema name to list functions from"),
  }),
  execute: async ({ schema }) => {
    const connectionId = getConnectionId();
    const functions = await invoke<FunctionInfo[]>("get_functions", {
      connectionId,
      schema,
    });
    return JSON.stringify(
      functions.map((f) => ({
        name: f.name,
        returnType: f.return_type,
      })),
      null,
      2
    );
  },
});
