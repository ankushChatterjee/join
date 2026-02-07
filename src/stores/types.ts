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

export interface EditorTab {
  id: string;
  name: string;
  content: string;
  connectionId: string; // Required - every tab must have a connection
  isDirty: boolean;
  createdAt: number;
}

// Scripts stored as .sql files
export interface ScriptMetadata {
  id: string;
  name: string;
  connection_id: string;
  created_at: number;
  updated_at: number;
}

export interface Script extends ScriptMetadata {
  content: string;
}

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
