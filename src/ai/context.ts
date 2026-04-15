// ============================================================================
// AI Agent - Context Builder
// ============================================================================

import { useAppStore } from "@/stores/appStore";
import {
  getSelectedText,
  getFullEditorContent,
  getCursorPosition,
} from "@/components/editor/editorUtils";
import type { AgentExecutionContext } from "./executionContext";
import { getCatalog } from "./skills/postgresBestPractices";

/**
 * Capture the current editor / cell state as a context block to be appended
 * to a user message at the moment the message is sent.  This keeps per-message
 * context tied to the message rather than living in the (shared) system prompt.
 *
 * Returns an empty string when there is nothing useful to include.
 */
export function buildMessageContext(executionContext?: AgentExecutionContext): string {
  const state = useAppStore.getState();
  const parts: string[] = [];
  let hasContext = false;
  const contextConnectionId = executionContext?.targetConnectionId ?? state.activeConnectionId;
  const contextConnection = contextConnectionId
    ? state.connections.find((c) => c.id === contextConnectionId) ?? null
    : null;

  const schemaFocusParts: string[] = [];
  if (state.activeSchema) {
    schemaFocusParts.push(`- **Active Schema**: \`${state.activeSchema}\``);
  }
  if (state.previewSource) {
    schemaFocusParts.push(`- **Previewing Object**: \`${state.previewSource}\``);
  }

  const expandedTables = Array.from(state.expandedTables).slice(0, 8);
  const expandedViews = Array.from(state.expandedViews).slice(0, 8);
  if (expandedTables.length > 0) {
    schemaFocusParts.push(`- **Expanded Tables**: ${expandedTables.map((t) => `\`${t}\``).join(", ")}`);
  }
  if (expandedViews.length > 0) {
    schemaFocusParts.push(`- **Expanded Views**: ${expandedViews.map((v) => `\`${v}\``).join(", ")}`);
  }

  if (state.selectedSchemaObject) {
    const obj = state.selectedSchemaObject;
    if (obj.type === "function") {
      schemaFocusParts.push(
        `- **Selected Function**: \`${obj.schema}.${obj.specificName || obj.name}\``
      );
    } else {
      schemaFocusParts.push(`- **Selected Type**: \`${obj.schema}.${obj.name}\``);
    }
  }

  const activeResultTab =
    state.activeEditorTab?.kind === "result"
      ? state.openResultTabs.find((t) => t.id === state.activeEditorTab?.id)
      : null;
  const activeScript = state.openScripts.find((s) => s.id === state.activeScriptId);

  if (activeResultTab) {
    const resultTabConnection = state.connections.find((c) => c.id === activeResultTab.connectionId);
    parts.push(`**Editor Mode**: Result Tab`);
    parts.push(`**Result Tab**: ${activeResultTab.name} (ID: ${activeResultTab.id})`);
    parts.push(
      `**Result Tab Database**: ${resultTabConnection?.database ?? activeResultTab.lastExecutedDatabase ?? "unknown"} (Connection ID: ${activeResultTab.connectionId})`
    );
    if (activeResultTab.savedResultId) {
      parts.push(`**Saved Result ID**: ${activeResultTab.savedResultId}`);
    }
    if (activeResultTab.previewSource) {
      parts.push(`**Preview Source**: ${activeResultTab.previewSource}`);
    }
    parts.push(`**Result Query Cell**:\n\`\`\`sql\n${activeResultTab.sqlCell.sql}\n\`\`\``);
    parts.push(
      `**Result Last Executed At**: ${activeResultTab.lastExecutedAt ? new Date(activeResultTab.lastExecutedAt).toISOString() : "never"}`
    );
    if (activeResultTab.queryResults) {
      parts.push(
        `**Result Stats**: ${activeResultTab.queryResults.row_count} rows, ${activeResultTab.queryResults.execution_time_ms}ms`
      );
    }
    hasContext = true;
  } else if (activeScript) {
    parts.push(`**Editor Mode**: SQL Sheet`);
    const selectedCell = activeScript.cells.find(
      (cell) => cell.id === activeScript.selectedCellId
    );

    const editorContent = getFullEditorContent();
    const selectedText = getSelectedText();
    const cursorPos = getCursorPosition();

    parts.push(`**SQL Sheet**: ${activeScript.name} (ID: ${activeScript.id})`);
    hasContext = true;

    if (selectedCell) {
      const cellIndex =
        activeScript.cells.findIndex((c) => c.id === selectedCell.id) + 1;
      parts.push(`**Selected Cell**: Cell ${cellIndex} (ID: ${selectedCell.id})`);
    } else {
      parts.push(`**Selected Cell**: None`);
    }

    if (activeScript.cells.length > 0) {
      const cellSummary = activeScript.cells
        .map((cell, index) => {
          const marker = cell.id === activeScript.selectedCellId ? " (selected)" : "";
          return `- Cell ${index + 1} (ID: ${cell.id})${marker}`;
        })
        .join("\n");
      parts.push(`**Sheet Cells**:\n${cellSummary}`);
    }

    if (selectedText) {
      parts.push(`**Selected SQL**:\n\`\`\`sql\n${selectedText}\n\`\`\``);
    }

    if (editorContent && editorContent !== selectedText) {
      parts.push(
        `**Selected Cell Content**:\n\`\`\`sql\n${editorContent}\n\`\`\``
      );
    }

    if (cursorPos) {
      parts.push(`**Cursor**: Line ${cursorPos.line}, Column ${cursorPos.col}`);
    }
  }

  if (schemaFocusParts.length > 0) {
    parts.push(`**Schema Tree Focus (high-priority context)**:\n${schemaFocusParts.join("\n")}`);
    hasContext = true;
  }

  if (executionContext) {
    const stamp = [
      `- **Connection**: \`${executionContext.targetConnectionId ?? "none"}\``,
      `- **Connection Dialect**: \`${executionContext.targetConnectionDialect ?? "unknown"}\``,
      `- **Connection Database**: \`${contextConnection?.database ?? "unknown"}\``,
      `- **Metadata Version**: \`${executionContext.metadataVersion ?? "unknown"}\``,
      `- **Result Tab ID**: \`${executionContext.activeResultTabId ?? "none"}\``,
      `- **Result Version**: \`${executionContext.resultVersion ?? "unknown"}\``,
      `- **Captured At**: \`${new Date(executionContext.capturedAt).toISOString()}\``,
    ];
    if (executionContext.metadataWarning) {
      stamp.push(`- **Metadata Warning**: ${executionContext.metadataWarning}`);
    }
    parts.push(`**Execution Context Stamp**:\n${stamp.join("\n")}`);
    hasContext = true;
  }

  if (!hasContext) return "";
  return `\n---\n**Context at time of message**\n${parts.join("\n")}`;
}

/**
 * Build the system prompt with full context about the current state.
 * This includes connection info, schema summary, editor state, etc.
 */
export function buildSystemPrompt(executionContext?: AgentExecutionContext): string {
  const parts: string[] = [];
  const state = useAppStore.getState();
  const activeResultTab =
    state.activeEditorTab?.kind === "result"
      ? state.openResultTabs.find((t) => t.id === state.activeEditorTab?.id) ?? null
      : null;
  const activeResultConnection = activeResultTab
    ? state.connections.find((c) => c.id === activeResultTab.connectionId) ?? null
    : null;

  // --- Role ---
  parts.push(
    `You are a SQL expert assistant for "Join", a database client application. Your goal is to help users write efficient, correct SQL queries, help users analyse and understand queries and explore their database schema.`
  );
  parts.push(
    `Act like an experienced Data Engineer or a DBA. Always think about scale, performance, and safety. When you see a problem, first break it down into smaller parts and think about them and solve them one by one, when you realise something new, do not be afraid to change your plan`
  );

  parts.push(
    `\nConnection-specific details (dialect, DB, active result tab context) are provided per message in the "Execution Context Stamp".`
  );

  parts.push(`\n## Runtime Context`);
  parts.push(`- Use tool calls to fetch fresh schema/data details instead of relying on potentially stale prompt state.`);
  parts.push(
    `- If the user asks for a query from the connected local folder, or you need app-code SQL context, call \`get_codebase_query\` before guessing.`
  );
  parts.push(
    `- If the user asks how a query is implemented, used, triggered, or consumed in the app, call \`ask_codex\` to gather codebase context before answering.`
  );
  parts.push(
    `- Do not pull all codebase queries by default. Use \`get_codebase_query\` for targeted lookup and only discuss ambiguity when the tool reports multiple plausible matches.`
  );
  if (executionContext?.targetConnectionId) {
    parts.push(`- Default target connection ID: \`${executionContext.targetConnectionId}\``);
  }
  if (executionContext?.metadataVersion != null) {
    parts.push(`- Expected metadata version for this run: \`${executionContext.metadataVersion}\``);
  }
  if (executionContext?.metadataWarning) {
    parts.push(`- Warning: ${executionContext.metadataWarning}`);
  }
  parts.push(
    `- Active result tab open: ${activeResultTab ? `yes (\`${activeResultTab.name}\`, id \`${activeResultTab.id}\`)` : "no"}`
  );
  if (activeResultTab) {
    parts.push(`- Active result tab query:\n\`\`\`sql\n${activeResultTab.sqlCell.sql}\n\`\`\``);
    parts.push(
      `- Active result tab last executed at: \`${activeResultTab.lastExecutedAt ? new Date(activeResultTab.lastExecutedAt).toISOString() : "never"}\``
    );
    parts.push(
      `- Active result tab database at last execution: \`${activeResultTab.lastExecutedDatabase ?? activeResultConnection?.database ?? "unknown"}\``
    );
    parts.push(`- Active result tab connection id: \`${activeResultTab.connectionId}\``);
  }

  // --- Query Building Workflow ---
  parts.push(`\n## Query Building Workflow`);
  parts.push(
    `Follow this 4-step sequence whenever you write a new SQL query. Do not skip steps.`
  );
  parts.push(
    `\n**Step 1 — PLAN**: Call \`plan_sql_query\` with your goal and the tables you believe are needed.\n` +
    `- If \`status\` is "error" (tables not found), correct the names and retry — do not proceed.\n` +
    `- \`plan_sql_query\` auto-discovers FK join paths. Do not call \`find_join_path\` separately.\n` +
    `- Skip this step ONLY for minor edits to existing SQL (e.g. "add LIMIT 10", "fix a column alias").`
  );
  parts.push(
    `\n**Step 2 — FETCH**: Call \`describe_table\` for every table listed in \`validated_tables\`.\n` +
    `- These calls can be made in parallel.\n` +
    `- Do not write any SQL before this step completes. Use only column names confirmed here.`
  );
  parts.push(
    `\n**Step 3 — WRITE**: Draft SQL using only verified column names from Step 2.\n` +
    `- Always use the correct dialect for the connected database.\n` +
    `- For Postgres, always call \`get_postgres_best_practice\` when drafting SQL to understand the best practices and apply them.\n` +
    `- Run \`lint_sql_safety\` with the current connection's dialect and resolve any high-severity warnings before continuing.\n` +
    `- Prefer the FK join conditions returned by \`plan_sql_query\` over guessing join predicates.\n`
  );
  parts.push(
    `\n**Step 4 — VERIFY**: Call \`explain_sql\` on the draft SQL.\n` +
    `- If \`safe_to_proceed\` is false or warnings mention sequential scans, call \`get_postgres_best_practice\` with the relevant rule_id (e.g. query-missing-indexes) and apply the fix.\n` +
    `- After passing verification, write the SQL with \`insert_sql\` or \`replace_editor_content\`.`
  );

  // --- DDL & Schema Design Workflow ---
  parts.push(`\n## DDL & Schema Design Workflow`);
  parts.push(
    `Follow this 4-step sequence whenever you write DDL — designing new tables, ` +
    `creating schemas, or evolving existing ones. Do not skip steps.`
  );
  parts.push(
    `\n**Step 1 — PLAN**: Call \`plan_ddl\` with your goal and the table names involved.\n` +
    `- For CREATE tasks: pass the proposed new table names in \`entities\` and any existing tables ` +
    `they will reference via FK in \`references\`. plan_ddl validates naming conflicts, fetches the ` +
    `PK column name + type of each referenced table (so your FK columns match exactly — do NOT guess), ` +
    `and surfaces reusable ENUMs/custom types already in the schema.\n` +
    `- For ALTER/EVOLVE tasks: pass the existing table names in \`entities\`. plan_ddl fetches their ` +
    `full current state (columns, indexes, FKs) and returns a \`ddl_risk_guide\` with the ` +
    `expand-and-contract risk classification you must follow.\n` +
    `- Do not draft any DDL before this step completes.`
  );
  parts.push(
    `\n**Step 2 — CONSULT**: Call \`get_postgres_best_practice\` for each rule_id in ` +
    `\`recommended_best_practice_rules\` returned by plan_ddl.\n` +
    `- Focus on the \`schema-*\` and \`lock-*\` rules. These rules define the exact patterns ` +
    `(PK strategy, constraint style, index coverage) you must apply in the DDL.`
  );
  parts.push( // TODO: This needs to be better
    `\n**Step 3 — WRITE**: Draft full DDL using plan_ddl output as ground truth.\n` +
    `- CREATE: use the exact PK type from \`referenced_existing_tables\` for every FK column. ` +
    `Reuse existing ENUMs from \`reusable_types\`. Always include: IDENTITY PK, ` +
    `\`CREATE INDEX\` for every FK column, \`NOT NULL\` where appropriate, ` +
    `\`TIMESTAMPTZ\` for timestamps, and \`COMMENT ON COLUMN\` for non-obvious columns.\n` +
    `- ALTER: follow \`migration_phases\` order (expand → migrate_data → contract). ` +
    `Never mix dangerous operations (DROP COLUMN, RENAME) with safe ones in the same DDL block. ` +
    `Use \`CREATE INDEX CONCURRENTLY\` and \`ADD CONSTRAINT … NOT VALID\` to avoid table locks.\n` +
    `- Call \`validate_ddl\` on the draft. Resolve all HIGH-severity issues before continuing.`
  );
  parts.push(
    `\n**Step 4 — PROPOSE**: Write each DDL block into a separate cell with \`add_cell\` (requires approval).\n` +
    `- One cell per migration phase. Never combine an expand phase with a contract phase.\n` +
    `- Briefly explain each cell: what it does, what lock risk it carries, and whether application ` +
    `code must be updated before running it.`
  );

  // --- General Instructions ---
  parts.push(`\n## Instructions`);
  parts.push(
    `- Treat \`Schema Tree Focus\` context attached to user messages as high-priority signals about what the user is working on.`
  );
  parts.push(
    `- \`insert_sql\` and \`replace_editor_content\` only modify the currently selected cell (shown as "Cell N" where N is its position).`
  );
  parts.push(
    `- Use \`add_cell\` when you need to create a new cell (especially if no cell is selected). This tool requires user approval. Use this only when are SURE that the user wants this query, always understand / explain the query to youself before adding it for the user. If you are not sure, ask the user an question`
  );
  parts.push(
    `- The \`execute_readonly_sql\` tool requires user approval and should be used when needed to verify data or explore the schema further. It only supports read-only queries (SELECT, EXPLAIN, SHOW, DESCRIBE etc).`
  );
  parts.push(
    `- Use \`read_results\` to inspect existing rows from an open result tab in batches before deciding to run a new query.`
  );
  parts.push(
    `- Tools may accept \`connection_id\`; when omitted, use the run's default connection.`
  );
  parts.push(
    `- When writing any SQL via insert cell or replace content, always view all the SQL as a whole, even when doing multiple tool calls. Analyse if it makes sense to generate the whole SQL.`
  );
  parts.push(
    `- Always explain your reasoning and the SQL you're writing. For complex or esoteric SQL concepts, briefly explain what the concept does.`
  );
  parts.push(
    `- Always prioritize safety and performance. Evaluate your own output and anticipate problems the query might cause.`
  );
  parts.push(
    `- When showing SQL in your response, format it cleanly with proper indentation.`
  );
  parts.push(
    `- Sometimes whether a schema or query is correct depends on how it is used in application code. When unsure, ask the user.`
  );
  parts.push(
    `- Use emojis only when absolutely necessary or explicitly requested. Avoid using them.`
  );

  // --- Postgres Best Practices (on-demand) ---
  if (executionContext?.targetConnectionDialect === "postgresql") {
    parts.push(`\n${getCatalog()}`);
  }

  return parts.join("\n");
}
