export type DatabaseType = "postgresql" | "mysql" | "sqlite";

export interface ConnectionInfo {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string | null;
  port: number | null;
  database: string;
  username: string | null;
  ssl_mode: string | null;
  is_connected: boolean;
}

export interface NewConnectionRequest {
  name: string;
  db_type: DatabaseType;
  host: string | null;
  port: number | null;
  database: string;
  username: string | null;
  password: string | null;
  ssl_mode: string | null;
}

export interface SchemaInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  schema: string | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
}

export interface ViewInfo {
  name: string;
  schema: string | null;
}

export interface IndexInfo {
  name: string;
  is_unique: boolean;
  is_primary: boolean;
}

export interface ForeignKeyInfo {
  constraint_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

export interface FunctionInfo {
  name: string;
  return_type: string | null;
  schema: string | null;
  /** Unique identifier for the function (includes argument types for overloaded functions) */
  specific_name: string;
}

export interface CustomTypeInfo {
  name: string;
  schema: string | null;
  type_kind: string; // "enum", "composite", "domain", "set"
}

export interface TypeFieldInfo {
  name: string;
  data_type: string;
}

export interface TypeDetailInfo {
  name: string;
  schema: string | null;
  type_kind: string;
  values: string[] | null;        // For ENUM/SET
  fields: TypeFieldInfo[] | null; // For composite types
  base_type: string | null;       // For domains
  constraint: string | null;      // For domains
}

export interface FunctionArgInfo {
  name: string | null;
  data_type: string;
  mode: string; // IN, OUT, INOUT, VARIADIC
  has_default: boolean;
}

export interface FunctionDetailInfo {
  name: string;
  schema: string | null;
  return_type: string | null;
  arguments: FunctionArgInfo[];
  language: string | null;
  definition: string | null;
  is_aggregate: boolean;
  volatility: string | null; // IMMUTABLE, STABLE, VOLATILE
  description: string | null;
}

export interface ColumnDef {
  name: string;
  type_name: string;
  is_primary_key?: boolean;
  is_indexed?: boolean;
}

export interface QueryResult {
  columns: ColumnDef[];
  rows: unknown[][];
  row_count: number;
  execution_time_ms: number;
}

export interface SavedResultMetadata {
  id: string;
  name: string;
  connection_id: string;
  sql: string;
  preview_source: string | null;
  row_count: number;
  execution_time_ms: number;
  created_at: number;
  updated_at: number;
}

export interface EditorTab {
  id: string;
  name: string;
  content: string;
  connectionId: string; // Required - every tab must have a connection
  isDirty: boolean;
  createdAt: number;
}

export interface ResultTabCell {
  id: string;
  sql: string;
  proposed_sql?: string | null;
}

export interface ResultTabData {
  id: string;
  name: string;
  connectionId: string;
  sqlCell: ResultTabCell;
  queryResults: QueryResult | null;
  lastExecutedAt: number | null;
  lastExecutedDatabase: string | null;
  previewSource: string | null;
  resultSource: "live" | "saved";
  savedResultId: string | null;
  isQueryCollapsed: boolean;
  isStale: boolean;
  isDirty: boolean;
  version: number;
  createdAt: number;
}

export interface ConnectionMetadataSnapshot {
  schemas: SchemaInfo[];
  tablesBySchema: Record<string, TableInfo[]>;
  viewsBySchema: Record<string, ViewInfo[]>;
  functionsBySchema: Record<string, FunctionInfo[]>;
  typesBySchema: Record<string, CustomTypeInfo[]>;
  columns: Record<string, ColumnInfo[]>;
  indexes: Record<string, IndexInfo[]>;
  version: number;
  isLoading: boolean;
  lastRefreshedAt: number | null;
}

export interface SqlSheetCell {
  id: string;
  sql: string;
  last_run_at: number | null;
  last_run_duration_ms: number | null;
  last_run_successful: boolean | null;
  proposed_sql?: string | null;
}

export interface SqlSheetDocument {
  version: number;
  selected_cell_id: string | null;
  cells: SqlSheetCell[];
}

// SQL sheets metadata
export interface ScriptMetadata {
  id: string;
  name: string;
  connection_id: string;
  created_at: number;
  updated_at: number;
}

export interface Script extends ScriptMetadata, SqlSheetDocument { }

// Query history entry for tracking executed queries
export interface QueryHistoryEntry {
  id: string;
  sql: string;
  connectionId: string;
  connectionName: string;
  timestamp: number;
  rowCount: number | null;
  executionTimeMs: number | null;
  error: string | null;
}
