import type { TableInfo, ViewInfo, ColumnInfo } from "@/stores/types";

/**
 * Build a CodeMirror SQL completion schema from Zustand store data.
 * 
 * The schema format is: { tableName: ["col1", "col2", ...] }
 * 
 * This enables autocomplete for:
 * - Table names (when typing after FROM, JOIN, etc.)
 * - Column names (when typing after "table.")
 * - Standalone column names (added as top-level entries)
 */
export function buildCompletionSchema(
  tablesBySchema: Record<string, TableInfo[]>,
  viewsBySchema: Record<string, ViewInfo[]>,
  columns: Record<string, ColumnInfo[]>
): { [key: string]: readonly string[] } {
  const schema: { [key: string]: string[] } = {};
  const allColumnNames = new Set<string>();

  // Add tables with their columns
  for (const [schemaName, tables] of Object.entries(tablesBySchema)) {
    for (const table of tables) {
      const key = `${schemaName}.${table.name}`;
      const cols = columns[key] || [];
      const colNames = cols.map((c) => c.name);
      
      // Collect all column names
      colNames.forEach((name) => allColumnNames.add(name));
      
      // Short name for convenience (most common usage)
      if (!schema[table.name]) {
        schema[table.name] = colNames;
      }
      // Qualified name for multi-schema databases
      schema[key] = colNames;
    }
  }

  // Add views with their columns (same structure as tables)
  for (const [schemaName, views] of Object.entries(viewsBySchema)) {
    for (const view of views) {
      const key = `${schemaName}.${view.name}`;
      const cols = columns[key] || [];
      const colNames = cols.map((c) => c.name);
      
      // Collect all column names
      colNames.forEach((name) => allColumnNames.add(name));
      
      // Short name (don't overwrite if table with same name exists)
      if (!schema[view.name]) {
        schema[view.name] = colNames;
      }
      // Qualified name
      schema[key] = colNames;
    }
  }

  // Add all column names as top-level entries (for standalone completion)
  // They appear as completable items without needing a table prefix
  for (const colName of allColumnNames) {
    if (!schema[colName]) {
      schema[colName] = []; // Empty array = no sub-completions, but the name itself is completable
    }
  }

  return schema;
}
