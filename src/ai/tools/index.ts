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
import { getCodebaseQuery } from "./codebaseTools";
import { askQuestion } from "./questionTool";
import { planSqlQuery, explainSql } from "./planTools";
import { getPostgresBestPractice } from "./postgresSkillTools";
import { planDdl } from "./planDdlTool";
import { validateDdl } from "./ddlTools";

/** All tools available to the AI agent, keyed by tool name */
export const allTools = {
  plan_sql_query: planSqlQuery,
  plan_ddl: planDdl,
  explain_sql: explainSql,
  validate_ddl: validateDdl,
  get_postgres_best_practice: getPostgresBestPractice,
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
  get_codebase_query: getCodebaseQuery,
  get_editor_context: getEditorContext,
  insert_sql: insertSql,
  replace_editor_content: replaceEditorContentTool,
  add_cell: addCellTool,
  ask_question: askQuestion,
};

export type AllToolsType = typeof allTools;
