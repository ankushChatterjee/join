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
