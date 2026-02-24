// ============================================================================
// AI Agent - Query Tools (Vercel AI SDK)
// ============================================================================

import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import type { AgentContext } from "../agent";

function resolveConnection(
  ctx: AgentContext | undefined,
  requestedConnectionId?: string
): { connectionId: string; crossConnection: boolean } {
  const state = useAppStore.getState();
  const defaultConnectionId = ctx?.executionContext.targetConnectionId ?? state.activeConnectionId;
  const connectionId = requestedConnectionId ?? defaultConnectionId;
  if (!connectionId) {
    throw new Error("No resolved database connection");
  }
  return {
    connectionId,
    crossConnection: Boolean(
      requestedConnectionId &&
      ctx?.executionContext.targetConnectionId &&
      requestedConnectionId !== ctx.executionContext.targetConnectionId
    ),
  };
}

function assertMetadataFresh(
  ctx: AgentContext | undefined,
  connectionId: string,
  requestedConnectionId?: string
) {
  const execution = ctx?.executionContext;
  if (!execution || requestedConnectionId || execution.targetConnectionId !== connectionId) return;
  const expected = execution.metadataVersion;
  if (expected == null) return;
  const current = useAppStore.getState().getConnectionMetadataVersion(connectionId);
  if (current > expected) {
    throw new Error(
      `Context snapshot is stale for connection ${connectionId}. Expected metadata v${expected}, current is v${current}. Please retry.`
    );
  }
}

// --- execute_readonly_sql ---
// This tool requires user approval. The approval flow is handled by awaiting
// a Promise inside execute() — the onRequestApproval callback is passed
// through the experimental_context from the streamText call.
export const executeReadonlySql = tool({
  description:
    "Execute a read-only SQL query against the connected database. This requires user approval before execution. Use this to explore the data, get a deeper understanding of the schema, performance issues to give the user the best possible answer. The query MUST be read-only (SELECT, EXPLAIN, SHOW, DESCRIBE). Do not use INSERT, UPDATE, DELETE, DROP, or any DDL statements. Always keep in mind that this query should be lightweight, if you are trying out a risky/expensive query, warn the user to its effect. Make sure that the query does not result in TOO MANY rows, that can pollute the context",
  inputSchema: z.object({
    sql: z.string().describe("The SQL query to execute. Must be a read-only query."),
    connection_id: z
      .string()
      .optional()
      .describe("Optional explicit connection ID. Defaults to run context connection."),
  }),
  execute: async ({ sql, connection_id }, { toolCallId, experimental_context, abortSignal }) => {
    const ctx = experimental_context as AgentContext | undefined;
    const { connectionId, crossConnection } = resolveConnection(ctx, connection_id);
    assertMetadataFresh(ctx, connectionId, connection_id);

    // Request user approval before executing
    if (ctx?.onRequestApproval) {
      const approved = await new Promise<boolean>((resolve) => {
        ctx.onRequestApproval!({
          toolCallId,
          toolName: "execute_readonly_sql",
          sql: crossConnection ? `${sql}\n-- Cross-connection target: ${connectionId}` : sql,
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

    const { connections } = useAppStore.getState();
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection?.is_connected) {
      throw new Error(`Database is not connected for connection ${connectionId}`);
    }

    const result = await invoke<{
      columns: { name: string }[];
      rows: unknown[][];
      row_count: number;
      execution_time_ms: number;
    }>("execute_query", {
      connectionId,
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
    if (crossConnection) {
      output += `\nConnection: ${connectionId} (cross-connection)`;
    }
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

// --- read_results ---
export const readResults = tool({
  description:
    "Read query result rows from an open result tab in batches. Use this to inspect already-executed results without re-running SQL.",
  inputSchema: z.object({
    tab_id: z
      .string()
      .optional()
      .describe("Optional open result tab ID. Defaults to the currently active result tab."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("0-based row offset for pagination. Default is 0."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Maximum rows to return in one batch (1-500). Default is 100."),
  }),
  execute: async ({ tab_id, offset = 0, limit = 100 }) => {
    const state = useAppStore.getState();
    const activeResultTabId = state.activeEditorTab?.kind === "result" ? state.activeEditorTab.id : null;
    const tabId = tab_id ?? activeResultTabId;

    if (!tabId) {
      return "No result tab is active. Open a result tab or pass tab_id.";
    }

    const tab = state.openResultTabs.find((t) => t.id === tabId);
    if (!tab) {
      const openTabIds = state.openResultTabs.map((t) => t.id);
      return `Result tab ${tabId} is not open. Open result tabs: ${openTabIds.join(", ") || "none"}.`;
    }

    if (!tab.queryResults) {
      return JSON.stringify(
        {
          tab: {
            id: tab.id,
            name: tab.name,
            connection_id: tab.connectionId,
            sql: tab.sqlCell.sql,
            last_executed_at: tab.lastExecutedAt ? new Date(tab.lastExecutedAt).toISOString() : null,
            last_executed_database: tab.lastExecutedDatabase,
          },
          error: "No query results are loaded for this tab.",
        },
        null,
        2
      );
    }

    const connection = state.connections.find((c) => c.id === tab.connectionId);
    const columns = tab.queryResults.columns.map((c) => c.name);
    const totalRows = tab.queryResults.rows.length;
    const batchRows = tab.queryResults.rows.slice(offset, offset + limit);
    const rows = batchRows.map((row, rowIndex) => {
      const rowObject: Record<string, unknown> = { _row_index: offset + rowIndex };
      columns.forEach((column, columnIndex) => {
        rowObject[column] = row[columnIndex];
      });
      return rowObject;
    });

    return JSON.stringify(
      {
        tab: {
          id: tab.id,
          name: tab.name,
          connection_id: tab.connectionId,
          connection_name: connection?.name ?? null,
          database: tab.lastExecutedDatabase ?? connection?.database ?? null,
          sql: tab.sqlCell.sql,
          last_executed_at: tab.lastExecutedAt ? new Date(tab.lastExecutedAt).toISOString() : null,
        },
        batch: {
          offset,
          limit,
          returned_rows: rows.length,
          total_rows: totalRows,
          has_more: offset + rows.length < totalRows,
        },
        columns,
        rows,
      },
      null,
      2
    );
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
