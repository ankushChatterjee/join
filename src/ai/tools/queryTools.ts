// ============================================================================
// AI Agent - Query Tools (Vercel AI SDK)
// ============================================================================

import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import type { AgentContext } from "../agent";

// --- execute_readonly_sql ---
// This tool requires user approval. The approval flow is handled by awaiting
// a Promise inside execute() — the onRequestApproval callback is passed
// through the experimental_context from the streamText call.
export const executeReadonlySql = tool({
  description:
    "Execute a read-only SQL query against the connected database. This requires user approval before execution. Use this sparingly and only when you need to verify data or check results. The query MUST be read-only (SELECT, EXPLAIN, SHOW, DESCRIBE). Do not use INSERT, UPDATE, DELETE, DROP, or any DDL statements.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL query to execute. Must be a read-only query."),
  }),
  execute: async ({ sql }, { toolCallId, experimental_context, abortSignal }) => {
    const ctx = experimental_context as AgentContext | undefined;

    // Request user approval before executing
    if (ctx?.onRequestApproval) {
      const approved = await new Promise<boolean>((resolve) => {
        ctx.onRequestApproval!({
          toolCallId,
          toolName: "execute_readonly_sql",
          sql,
          resolve,
        });
      });

      if (abortSignal?.aborted) {
        throw new Error("Aborted");
      }

      if (!approved) {
        return "User declined to execute this query. Please adjust your approach or ask what they'd like instead.";
      }
    }

    const { activeConnectionId, connections } = useAppStore.getState();
    if (!activeConnectionId) {
      throw new Error("No active database connection");
    }

    const connection = connections.find((c) => c.id === activeConnectionId);
    if (!connection?.is_connected) {
      throw new Error("Database is not connected");
    }

    const result = await invoke<{
      columns: { name: string }[];
      rows: unknown[][];
      row_count: number;
      execution_time_ms: number;
    }>("execute_query", {
      connectionId: activeConnectionId,
      sql,
    });

    // Format result as readable text
    if (result.rows.length === 0) {
      return `Query executed successfully. No rows returned. (${result.execution_time_ms}ms)`;
    }

    const columnNames = result.columns.map((c) => c.name);
    const maxRows = 50;
    const displayRows = result.rows.slice(0, maxRows);

    let output = `Columns: ${columnNames.join(", ")}\n`;
    output += `Rows (${result.row_count} total, showing ${displayRows.length}):\n`;

    for (const row of displayRows) {
      const rowObj: Record<string, unknown> = {};
      columnNames.forEach((col, i) => {
        rowObj[col] = row[i];
      });
      output += JSON.stringify(rowObj) + "\n";
    }

    output += `\nExecution time: ${result.execution_time_ms}ms`;
    return output;
  },
});

// --- get_query_history ---
export const getQueryHistory = tool({
  description:
    "Get recent query history. Useful for understanding what queries have been run recently.",
  inputSchema: z.object({
    limit: z
      .string()
      .optional()
      .describe("Maximum number of history entries to return (default 10, max 50)"),
  }),
  execute: async ({ limit: limitStr }) => {
    const { queryHistory } = useAppStore.getState();
    const limit = Math.min(parseInt(limitStr || "10") || 10, 50);

    const entries = queryHistory.slice(0, limit).map((entry) => ({
      sql: entry.sql,
      connectionName: entry.connectionName,
      timestamp: new Date(entry.timestamp).toISOString(),
      rowCount: entry.rowCount,
      executionTimeMs: entry.executionTimeMs,
      error: entry.error,
    }));

    return JSON.stringify(entries, null, 2);
  },
});
