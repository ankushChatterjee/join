// ============================================================================
// AI Agent - Context Builder
// ============================================================================

import { useAppStore } from "@/stores/appStore";
import {
  getSelectedText,
  getFullEditorContent,
  getCursorPosition,
} from "@/components/editor/editorUtils";

/**
 * Capture the current editor / cell state as a context block to be appended
 * to a user message at the moment the message is sent.  This keeps per-message
 * context tied to the message rather than living in the (shared) system prompt.
 *
 * Returns an empty string when there is nothing useful to include.
 */
export function buildMessageContext(): string {
  const state = useAppStore.getState();
  const parts: string[] = [];
  let hasContext = false;

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

  const activeScript = state.openScripts.find(
    (s) => s.id === state.activeScriptId
  );

  if (activeScript) {
    const selectedCell = activeScript.cells.find(
      (cell) => cell.id === activeScript.selectedCellId
    );

    const editorContent = getFullEditorContent();
    const selectedText = getSelectedText();
    const cursorPos = getCursorPosition();

    parts.push(`**SQL Sheet**: ${activeScript.name}`);
    hasContext = true;

    if (selectedCell) {
      const cellIndex =
        activeScript.cells.findIndex((c) => c.id === selectedCell.id) + 1;
      parts.push(`**Selected Cell**: Cell ${cellIndex}`);
    } else {
      parts.push(`**Selected Cell**: None`);
    }

    if (activeScript.cells.length > 0) {
      const cellSummary = activeScript.cells
        .map((cell, index) => {
          const marker = cell.id === activeScript.selectedCellId ? " (selected)" : "";
          return `- Cell ${index + 1}${marker}`;
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

  if (!hasContext) return "";
  return `\n---\n**Context at time of message**\n${parts.join("\n")}`;
}

/**
 * Build the system prompt with full context about the current state.
 * This includes connection info, schema summary, editor state, etc.
 */
export function buildSystemPrompt(): string {
  const state = useAppStore.getState();

  const parts: string[] = [];

  // --- Role ---
  parts.push(
    `You are a SQL expert assistant for "Join", a database client application. Your goal is to help users write efficient, correct SQL queries, help users analyse and understand queries and explore their database schema.`
  );

  // --- Connection Info ---
  const connection = state.connections.find(
    (c) => c.id === state.activeConnectionId
  );
  if (connection) {
    parts.push(`\n## Current Connection`);
    parts.push(`- **Name**: ${connection.name}`);
    parts.push(`- **Type**: ${connection.db_type.toUpperCase()}`);
    if (connection.host) parts.push(`- **Host**: ${connection.host}`);
    parts.push(`- **Database**: ${connection.database}`);
    parts.push(
      `- **Status**: ${connection.is_connected ? "Connected" : "Disconnected"}`
    );
    parts.push(
      `\nAlways write SQL appropriate for the ${connection.db_type.toUpperCase()} dialect.`
    );
  } else {
    parts.push(
      `\nNo active database connection. You can still help with general SQL questions.`
    );
  }

  // --- Schema Summary (names only — AI uses describe_table for column details) ---
  if (state.schemas.length > 0) {
    parts.push(`\n## Database Schema Summary`);
    parts.push(`Only object names are listed below. Use the \`describe_table\` tool to get column details for any table or view when needed.\n`);

    for (const schema of state.schemas) {
      const tables = state.tablesBySchema[schema.name] || [];
      const views = state.viewsBySchema[schema.name] || [];
      const functions = state.functionsBySchema[schema.name] || [];
      const types = state.typesBySchema[schema.name] || [];

      if (tables.length === 0 && views.length === 0 && functions.length === 0 && types.length === 0) continue;

      parts.push(`### Schema: \`${schema.name}\``);

      if (tables.length > 0) {
        parts.push(`**Tables**: ${tables.map((t) => `\`${t.name}\``).join(", ")}`);
      }
      if (views.length > 0) {
        parts.push(`**Views**: ${views.map((v) => `\`${v.name}\``).join(", ")}`);
      }
      if (functions.length > 0) {
        parts.push(`**Functions**: ${functions.map((f) => `\`${f.name}\``).join(", ")}`);
      }
      if (types.length > 0) {
        parts.push(`**Types**: ${types.map((t) => `\`${t.name}\``).join(", ")}`);
      }
    }
  }

  // Note: Editor/cell context is NOT included here — it is captured at send time
  // via buildMessageContext() and appended to each user message individually.
  // This ensures the context snapshot is tied to the message, not shared globally.

  // --- Instructions ---
  parts.push(`\n## Instructions`);
  parts.push(
    `- Use the available tools to explore the database schema before writing queries when you need more detail.`
  );
  parts.push(
    `- Treat \`Schema Tree Focus\` context attached to user messages as high-priority signals about what the user is working on.`
  );
  parts.push(
    `- When writing SQL, always use the correct dialect for the connected database.`
  );
  parts.push(
    `- \`insert_sql\` and \`replace_editor_content\` only modify the currently selected cell.`
  );
  parts.push(
    `- Use \`add_cell\` when you need to create a new cell (especially if no cell is selected).`
  );
  parts.push(
    `- The \`execute_readonly_sql\` tool requires user approval and should only be used when truly needed to verify data or test queries. It only supports read-only queries (SELECT, EXPLAIN, SHOW, DESCRIBE etc).`
  );
  parts.push(
    `- When writing JOINs, prefer using foreign key relationships surfaced by \`describe_table\` to ensure correct join conditions.`
  );
  parts.push(
    `- When users ask for relationships across tables, use \`find_join_path\` before finalizing JOIN SQL if the path is not explicit.`
  );
  parts.push(
    `- Before returning final SQL, run \`lint_sql_safety\` on your candidate query and address or explicitly mention warnings.`
  );
  parts.push(
    `- Always explain your reasoning and the SQL you're writing, and when explaining give a brief about the SQL concept you are using if the concept is complex/esoteric`
  );
  parts.push(
    `- Always prioritize safety and performance, evaluate yourself and try to find out the problems that might come due to your query.`
  );
  parts.push(
    `- When showing SQL in your response, format it cleanly with proper indentation.`
  );
  parts.push(
    `- Sometimes, whether a schema or a query is good or not depends on the usage of it in code or elsewhere, when such confusion arrives as the user that question.`
  );
  parts.push(
    `- Use emojis only when absolutely necessary.`
  );


  return parts.join("\n");
}
