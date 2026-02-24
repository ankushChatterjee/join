// ============================================================================
// AI Agent - All Tools (aggregated export)
// ============================================================================

import {
  listSchemas,
  listTables,
  describeTable,
  listViews,
  describeView,
  listFunctions,
  findJoinPath,
} from "./schemaTools";
import { executeReadonlySql, getQueryHistory, lintSqlSafety, readResults } from "./queryTools";
import {
  getEditorContext,
  insertSql,
  replaceEditorContentTool,
  addCellTool,
} from "./editorTools";

/** All tools available to the AI agent, keyed by tool name */
export const allTools = {
  list_schemas: listSchemas,
  list_tables: listTables,
  describe_table: describeTable,
  list_views: listViews,
  describe_view: describeView,
  list_functions: listFunctions,
  find_join_path: findJoinPath,
  execute_readonly_sql: executeReadonlySql,
  get_query_history: getQueryHistory,
  read_results: readResults,
  lint_sql_safety: lintSqlSafety,
  get_editor_context: getEditorContext,
  insert_sql: insertSql,
  replace_editor_content: replaceEditorContentTool,
  add_cell: addCellTool,
};

export type AllToolsType = typeof allTools;
