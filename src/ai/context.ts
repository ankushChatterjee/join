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

  // --- Editor Context ---
  const editorContent = getFullEditorContent();
  const selectedText = getSelectedText();
  const cursorPos = getCursorPosition();
  const activeScript = state.openScripts.find(
    (s) => s.id === state.activeScriptId
  );
  const selectedCell = activeScript?.cells.find(
    (cell) => cell.id === activeScript.selectedCellId
  );

  if (editorContent || selectedText) {
    parts.push(`\n## Current Editor State`);
    if (activeScript) {
      parts.push(`**SQL Sheet**: ${activeScript.name}`);
      parts.push(
        `**Selected Cell**: ${selectedCell
          ? activeScript.cells.findIndex((cell) => cell.id === selectedCell.id) + 1
          : "None"
        }`
      );
      if (activeScript.cells.length > 0) {
        parts.push(`**Sheet Cell Count**: ${activeScript.cells.length}`);
      }
    }
    if (selectedText) {
      parts.push(`**Selected SQL**:\n\`\`\`sql\n${selectedText}\n\`\`\``);
    }
    if (editorContent && editorContent !== selectedText) {
      parts.push(
        `**Selected Cell Content**:\n\`\`\`sql\n${editorContent}\n\`\`\``
      );
    }
    if (activeScript?.cells.length) {
      const cellSummary = activeScript.cells
        .map((cell, index) => {
          const marker = cell.id === activeScript.selectedCellId ? " (selected)" : "";
          return `- Cell ${index + 1}${marker}`;
        })
        .join("\n");
      parts.push(`**Cells**:\n${cellSummary}`);
    }
    if (cursorPos) {
      parts.push(`**Cursor**: Line ${cursorPos.line}, Column ${cursorPos.col}`);
    }
  }

  // --- Instructions ---
  parts.push(`\n## Instructions`);
  parts.push(
    `- Use the available tools to explore the database schema before writing queries when you need more detail.`
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
    `- Always explain your reasoning and the SQL you're writing.`
  );
  parts.push(
    `- Always prioritize safety and performance, evaluate yourself and try to find out the problems that might come due to your query.`
  );
  parts.push(
    `- When showing SQL in your response, format it cleanly with proper indentation.`
  );

  return parts.join("\n");
}
