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
    "Execute a read-only SQL query against the connected database. This requires user approval before execution. Use this to explore the data, get a deeper understanding of the schema, performance issues to give the user the best possible answer. The query MUST be read-only (SELECT, EXPLAIN, SHOW, DESCRIBE). Do not use INSERT, UPDATE, DELETE, DROP, or any DDL statements. Always keep in mind that this query should be lightweight, if you are trying out a risky/expensive query, warn the user to its effect. Make sure that the query does not result in TOO MANY rows, that can pollute the context",
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

// --- lint_sql_safety ---
export const lintSqlSafety = tool({
  description:
    "Run lightweight SQL safety and performance lint checks. Use this before returning final SQL to surface risky patterns.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL query to lint for safety/performance issues"),
  }),
  execute: async ({ sql }) => {
    const warnings: Array<{
      severity: "high" | "medium" | "low";
      code: string;
      message: string;
      suggestion: string;
    }> = [];

    const text = sql.trim();
    const lower = text.toLowerCase();

    const hasKeyword = (regex: RegExp) => regex.test(lower);
    const pushWarning = (
      severity: "high" | "medium" | "low",
      code: string,
      message: string,
      suggestion: string
    ) => {
      warnings.push({ severity, code, message, suggestion });
    };

    if (hasKeyword(/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/)) {
      pushWarning(
        "high",
        "NON_READONLY_STATEMENT",
        "Query appears to include write/DDL operations.",
        "Keep AI-generated queries read-only unless the user explicitly asks for write operations."
      );
    }

    if (hasKeyword(/\bselect\s+\*/)) {
      pushWarning(
        "medium",
        "SELECT_STAR",
        "Using SELECT * can pull unnecessary columns and increase payload size.",
        "Select only the columns needed for the task."
      );
    }

    const joinCount = (lower.match(/\bjoin\b/g) || []).length;
    const onCount = (lower.match(/\bon\b/g) || []).length;
    const usingCount = (lower.match(/\busing\s*\(/g) || []).length;
    const naturalJoinCount = (lower.match(/\bnatural\s+join\b/g) || []).length;
    if (joinCount > 0 && onCount + usingCount + naturalJoinCount < joinCount) {
      pushWarning(
        "high",
        "POSSIBLE_CARTESIAN_JOIN",
        "One or more JOIN clauses might be missing ON/USING predicates.",
        "Ensure every join has an explicit and correct join condition."
      );
    }

    const isSelectLike =
      hasKeyword(/^\s*select\b/) ||
      hasKeyword(/^\s*with\b/) ||
      hasKeyword(/^\s*explain\b/);
    const hasLimit = hasKeyword(/\blimit\s+\d+/);
    const hasWhere = hasKeyword(/\bwhere\b/);

    if (isSelectLike && !hasLimit && !hasWhere) {
      pushWarning(
        "medium",
        "UNBOUNDED_SCAN",
        "Query may scan a large amount of data without filters or row limits.",
        "Add WHERE predicates and/or LIMIT when exploring data."
      );
    }

    if (hasKeyword(/\border\s+by\b/) && !hasLimit) {
      pushWarning(
        "low",
        "ORDER_BY_WITHOUT_LIMIT",
        "ORDER BY without LIMIT can be expensive on large result sets.",
        "Add LIMIT when only top rows are needed."
      );
    }

    if (hasKeyword(/\bnot\s+in\s*\(\s*select\b/)) {
      pushWarning(
        "low",
        "NOT_IN_SUBQUERY_NULL_RISK",
        "NOT IN with subqueries can behave unexpectedly when NULLs are present.",
        "Prefer NOT EXISTS or ensure subquery excludes NULL values."
      );
    }

    return JSON.stringify(
      {
        safe: warnings.every((w) => w.severity !== "high"),
        warning_count: warnings.length,
        warnings,
      },
      null,
      2
    );
  },
});
