// ============================================================================
// AI Agent - Query Tools (Vercel AI SDK)
// ============================================================================

import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { Parser } from "node-sql-parser";
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
    "Run SQL safety and performance lint checks. Use this before returning final SQL to surface risky patterns, logical errors and dialect-specific syntax issues.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL query to lint for safety/performance issues"),
    dialect: z.enum(["postgresql", "mysql", "sqlite"]).describe("The SQL dialect of the current connection"),
  }),
  execute: async ({ sql, dialect }) => {
    const warnings: Array<{
      severity: "high" | "medium" | "low";
      code: string;
      message: string;
      suggestion: string;
    }> = [];

    const text = sql.trim();

    // 1. Strip comments and literals to avoid false positives in regex
    const stripSql = (s: string) => {
      // Remove single-line comments
      let clean = s.replace(/--.*$/gm, "");
      // Remove multi-line comments
      clean = clean.replace(/\/\*[\s\S]*?\*\//g, "");
      // Replace string literals (approximated)
      clean = clean.replace(/'[^']*'/g, "''");
      clean = clean.replace(/"[^"]*"/g, '""');
      return clean;
    };

    const cleanSql = stripSql(text);
    const lower = cleanSql.toLowerCase();

    const hasKeyword = (regex: RegExp) => regex.test(lower);
    const pushWarning = (
      severity: "high" | "medium" | "low",
      code: string,
      message: string,
      suggestion: string
    ) => {
      warnings.push({ severity, code, message, suggestion });
    };

    // --- SAFETY CHECKS (Regex) ---

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

    // Fix Cartesian Join check: Avoid matching ON DELETE, ON UPDATE, ON CONFLICT
    // Also ignore CROSS JOIN which is intentional
    const joinMatches = lower.match(/\bjoin\b/g) || [];
    const crossJoinMatches = lower.match(/\bcross\s+join\b/g) || [];
    const actualJoins = joinMatches.length - crossJoinMatches.length;

    const onMatches = lower.match(/\bon\s+/g) || [];
    const filteredOnCount = onMatches.filter((m) => {
      const index = lower.indexOf(m);
      const precedingText = lower.substring(Math.max(0, index - 20), index);
      return !precedingText.match(/\b(delete|update|conflict)\b/);
    }).length;

    const usingCount = (lower.match(/\busing\s*\(/g) || []).length;
    const naturalJoinCount = (lower.match(/\bnatural\s+join\b/g) || []).length;

    if (actualJoins > 0 && filteredOnCount + usingCount + naturalJoinCount < actualJoins) {
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

    // --- DIALECT SPECIFIC CHECKS (Regex) ---

    if (dialect !== "postgresql") {
      if (hasKeyword(/\bilike\b/)) {
        pushWarning(
          "high",
          "POSTGRES_SPECIFIC_ILIKE",
          "ILIKE is PostgreSQL-specific.",
          `Use LOWER(col) LIKE LOWER(val) for ${dialect}.`
        );
      }
      if (hasKeyword(/::[a-zA-Z]+/)) {
        pushWarning(
          "high",
          "POSTGRES_SPECIFIC_CAST",
          ":: cast operator is PostgreSQL-specific.",
          `Use CAST(expr AS type) for ${dialect}.`
        );
      }
      if (hasKeyword(/\breturning\b/)) {
        pushWarning(
          "high",
          "POSTGRES_SPECIFIC_RETURNING",
          "RETURNING clause is not universally supported outside PostgreSQL.",
          `Check if ${dialect} supports RETURNING (MariaDB does, MySQL does not).`
        );
      }
    }

    if (dialect === "postgresql") {
      if (hasKeyword(/`[^`]+`/)) {
        pushWarning(
          "high",
          "MYSQL_SPECIFIC_IDENTIFIER",
          "Backticks are not supported in PostgreSQL.",
          "Use double-quotes for identifiers."
        );
      }
      if (hasKeyword(/\bifnull\s*\(/)) {
        pushWarning(
          "high",
          "MYSQL_SPECIFIC_IFNULL",
          "IFNULL is MySQL-specific.",
          "Use COALESCE() which is standard."
        );
      }
      if (hasKeyword(/\bgroup_concat\s*\(/)) {
        pushWarning(
          "high",
          "MYSQL_SPECIFIC_GROUP_CONCAT",
          "GROUP_CONCAT is MySQL-specific.",
          "Use STRING_AGG() in PostgreSQL."
        );
      }
    }

    if (dialect === "mysql") {
      if (hasKeyword(/\bfull\s+outer\s+join\b/) || hasKeyword(/\bfull\s+join\b/)) {
        pushWarning(
          "high",
          "MYSQL_MISSING_FULL_JOIN",
          "MySQL does not support FULL OUTER JOIN.",
          "Use LEFT JOIN UNION RIGHT JOIN or reconsider the logic."
        );
      }
    }

    if (dialect === "sqlite") {
      if (hasKeyword(/\bright\s+join\b/) || hasKeyword(/\bfull\s+outer\s+join\b/) || hasKeyword(/\bfull\s+join\b/)) {
        pushWarning(
          "high",
          "SQLITE_MISSING_RIGHT_FULL_JOIN",
          "Older SQLite versions do not support RIGHT or FULL OUTER JOIN.",
          "Use LEFT JOIN with tables swapped or UNION logic."
        );
      }
    }

    // --- CORRECTNESS CHECKS (Regex) ---

    if (hasKeyword(/=\s*null\b/) || hasKeyword(/<>\s*null\b/) || hasKeyword(/!=\s*null\b/)) {
      pushWarning(
        "high",
        "NULL_EQUALITY_COMPARISON",
        "Using = NULL or <> NULL is incorrect.",
        "Use IS NULL or IS NOT NULL."
      );
    }

    if (hasKeyword(/\bwhere\b.*?\b(count|sum|avg|min|max)\s*\(/)) {
      pushWarning(
        "high",
        "AGGREGATE_IN_WHERE",
        "Aggregates (COUNT, SUM, etc.) cannot be used in a WHERE clause.",
        "Use HAVING if you need to filter on aggregate results."
      );
    }

    // --- AST CHECKS (Structural analysis) ---
    const parser = new Parser();
    try {
      const dbMap: Record<string, string> = {
        postgresql: "postgresql",
        mysql: "mysql",
        sqlite: "sqlite",
      };
      // Use "postgresql" as fallback for parser database type
      const ast = parser.astify(text, { database: dbMap[dialect] || "postgresql" });
      const astArray = Array.isArray(ast) ? (ast as any[]) : [ast as any];

      for (const node of astArray) {
        if (node.type === "select") {
          // Check for HAVING without GROUP BY
          if (node.having && !node.groupby) {
            pushWarning(
              "high",
              "HAVING_WITHOUT_GROUP_BY",
              "HAVING clause used without GROUP BY.",
              "Add GROUP BY or move filtering logic to WHERE if possible."
            );
          }

          // Check for aggregate functions in WHERE (more precise than regex)
          // We can't easily traverse the WHERE tree here without a recursive visitor,
          // but we can check if window functions are used without OVER
          const checkNode = (obj: any) => {
            if (!obj || typeof obj !== "object") return;
            // When parsed as a regular function (missing OVER), it might be a window function used incorrectly
            if (obj.type === "function") {
              let funcName = "";
              if (typeof obj.name === "string") {
                funcName = obj.name;
              } else if (obj.name && Array.isArray(obj.name.name)) {
                // node-sql-parser nests names like { name: [{ value: 'row_number' }] }
                funcName = obj.name.name[0]?.value || "";
              }

              if (
                ["row_number", "rank", "dense_rank", "ntile", "lag", "lead"].includes(
                  funcName.toLowerCase()
                )
              ) {
                pushWarning(
                  "high",
                  "WINDOW_FUNCTION_WITHOUT_OVER",
                  `Window function ${funcName.toUpperCase()} requires an OVER clause.`,
                  "Add OVER() or OVER(PARTITION BY ... ORDER BY ...)."
                );
              }
            }
            Object.values(obj).forEach(checkNode);
          };
          checkNode(node);
        }
      }
    } catch (e) {
      // Fallback: Parser might fail on complex or dialect-specific syntax
      // We've already run regex checks which are more resilient
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
