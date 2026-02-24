import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionInfo,
  NewConnectionRequest,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  ViewInfo,
  IndexInfo,
  FunctionInfo,
  CustomTypeInfo,
  TypeDetailInfo,
  FunctionDetailInfo,
  QueryResult,
  ScriptMetadata,
  Script,
  SqlSheetCell,
  SqlSheetDocument,
  QueryHistoryEntry,
  SavedResultMetadata,
  ResultTabData,
  ConnectionMetadataSnapshot,
} from "./types";

export interface Toast {
  id: string;
  type: "error" | "success" | "info";
  message: string;
}

// Open script in editor (script with content loaded)
interface OpenScript {
  id: string;
  name: string;
  connectionId: string;
  cells: SqlSheetCell[];
  selectedCellId: string | null;
  isDirty: boolean;
}

type ActiveEditorTab = { kind: "script" | "result"; id: string } | null;
type SavedResultRecord = SavedResultMetadata & { query_result: QueryResult };

interface AppState {
  // Connections
  connections: ConnectionInfo[];
  activeConnectionId: string | null;
  isLoadingConnections: boolean;

  // Schema
  schemas: SchemaInfo[];
  tablesBySchema: Record<string, TableInfo[]>; // schemaName -> tables
  viewsBySchema: Record<string, ViewInfo[]>; // schemaName -> views
  functionsBySchema: Record<string, FunctionInfo[]>; // schemaName -> functions
  typesBySchema: Record<string, CustomTypeInfo[]>; // schemaName -> custom types
  columns: Record<string, ColumnInfo[]>; // "schema.table" -> columns
  indexes: Record<string, IndexInfo[]>; // "schema.table" -> indexes
  activeSchema: string | null;
  isLoadingSchema: boolean;
  loadingSchemas: Set<string>; // schemas currently loading tables/views/functions
  metadataByConnection: Record<string, ConnectionMetadataSnapshot>;

  // Selected schema object (for showing details in results panel)
  selectedSchemaObject: {
    type: "function" | "custom_type";
    name: string;
    schema: string;
    /** Unique identifier for functions (to handle overloaded functions) */
    specificName?: string;
  } | null;
  schemaObjectDetails: TypeDetailInfo | FunctionDetailInfo | null;
  isLoadingSchemaObjectDetails: boolean;

  // SQL sheets (stored as JSON files per connection)
  scriptsByConnection: Record<string, ScriptMetadata[]>; // connectionId -> scripts
  isScriptsFolderExpanded: boolean;
  savedResultsByConnection: Record<string, SavedResultMetadata[]>;
  isSavedResultsFolderExpanded: boolean;

  // Tree UI State
  expandedSchemas: Set<string>;
  expandedTables: Set<string>; // "schema.table" format
  expandedViews: Set<string>; // "schema.view" format
  expandedIndexFolders: Set<string>; // "schema.table" or "schema.view" format
  isDbExpanded: boolean;

  // Query
  queryResults: QueryResult | null;
  isExecuting: boolean;
  executingCell: { scriptId: string; cellId: string } | null;
  queryError: string | null;
  previewSource: string | null; // "schema.table" when previewing a table/view
  querySql: string | null; // SQL that produced current queryResults

  // Query History
  queryHistory: QueryHistoryEntry[];

  // UI State
  isConnectionDialogOpen: boolean;
  editingConnection: ConnectionInfo | null;
  toasts: Toast[];
  isResultsPanelMinimized: boolean;

  // Open Scripts (tabs in editor)
  openScripts: OpenScript[];
  activeScriptId: string | null;
  openResultTabs: ResultTabData[];
  activeEditorTab: ActiveEditorTab;

  // Actions - Connections
  loadConnections: () => Promise<void>;
  addConnection: (request: NewConnectionRequest) => Promise<ConnectionInfo>;
  updateConnection: (id: string, request: NewConnectionRequest) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (request: NewConnectionRequest) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  setActiveConnection: (id: string | null) => void;

  // Actions - Schema
  loadSchemas: () => Promise<void>;
  loadTablesForSchema: (schema: string) => Promise<void>;
  loadViewsForSchema: (schema: string) => Promise<void>;
  loadColumns: (table: string, schema: string) => Promise<void>;
  loadIndexes: (table: string, schema: string) => Promise<void>;
  loadTypesForSchema: (schema: string) => Promise<void>;
  setActiveSchema: (schema: string | null) => void;
  refreshConnectionMetadata: (connectionId: string) => Promise<void>;
  ensureMetadataReady: (connectionId: string, timeoutMs?: number) => Promise<{ ready: boolean; timedOut: boolean }>;
  getConnectionMetadataVersion: (connectionId: string) => number;
  selectSchemaObject: (
    type: "function" | "custom_type",
    name: string,
    schema: string,
    specificName?: string
  ) => Promise<void>;
  clearSchemaObjectSelection: () => void;

  // Actions - Scripts
  loadScripts: (connectionId: string) => Promise<void>;
  loadSavedResults: (connectionId: string) => Promise<void>;
  createScript: (connectionId: string) => Promise<string | null>;
  openScript: (connectionId: string, scriptId: string) => Promise<void>;
  closeScript: (scriptId: string) => void;
  setActiveScript: (scriptId: string) => void;
  setSelectedScriptCell: (scriptId: string, cellId: string | null) => void;
  addScriptCell: (scriptId: string, sql?: string, selectNewCell?: boolean) => Promise<string | null>;
  removeScriptCell: (scriptId: string, cellId: string) => Promise<void>;
  updateScriptCellRunMetadata: (
    scriptId: string,
    cellId: string,
    updates: Pick<SqlSheetCell, "last_run_at" | "last_run_duration_ms" | "last_run_successful">
  ) => Promise<void>;
  updateScriptCellProposal: (scriptId: string, cellId: string, proposedSql: string | null) => void;
  acceptScriptCellProposal: (scriptId: string, cellId: string) => void;
  rejectScriptCellProposal: (scriptId: string, cellId: string) => void;
  executeScriptCell: (scriptId: string, cellId: string) => Promise<void>;
  updateScriptContent: (scriptId: string, content: string) => void;
  saveScript: (scriptId: string) => Promise<void>;
  renameScript: (scriptId: string, name: string) => Promise<void>;
  deleteScript: (connectionId: string, scriptId: string) => Promise<void>;
  toggleScriptsFolderExpanded: () => void;
  toggleSavedResultsFolderExpanded: () => void;
  popOutResultsToTab: () => void;
  saveCurrentResults: () => Promise<void>;
  openSavedResult: (connectionId: string, savedResultId: string) => Promise<void>;
  refreshResultTab: (tabId: string) => Promise<void>;
  updateResultTabSql: (tabId: string, sql: string) => void;
  updateResultTabProposal: (tabId: string, proposedSql: string | null) => void;
  acceptResultTabProposal: (tabId: string) => void;
  rejectResultTabProposal: (tabId: string) => void;
  toggleResultQueryExpanded: (tabId: string) => void;
  setActiveResultTab: (tabId: string) => void;
  closeResultTab: (tabId: string) => void;
  deleteSavedResult: (connectionId: string, savedResultId: string) => Promise<void>;
  renameSavedResult: (connectionId: string, savedResultId: string, name: string) => Promise<void>;

  // Actions - Tabs Persistence
  loadOpenTabs: () => Promise<void>;
  saveOpenTabs: () => Promise<void>;

  // Actions - Tree UI
  toggleDbExpanded: () => void;
  toggleSchemaExpanded: (schema: string) => void;
  toggleTableExpanded: (schema: string, table: string) => void;
  toggleViewExpanded: (schema: string, view: string) => void;
  toggleIndexFolderExpanded: (schema: string, tableOrView: string) => void;

  // Actions - Query
  executeQuery: (sql: string) => Promise<void>;
  executeQueryDirect: (connectionId: string, sql: string, previewSource?: string) => Promise<void>;
  clearResults: () => void;
  loadQueryHistory: () => Promise<void>;
  clearQueryHistory: () => void;

  // Actions - UI
  openConnectionDialog: (connection?: ConnectionInfo) => void;
  closeConnectionDialog: () => void;
  showToast: (type: Toast["type"], message: string) => void;
  dismissToast: (id: string) => void;
  toggleResultsPanelMinimized: () => void;
}

const SHEET_FORMAT_VERSION = 1;

function createEmptyCell(sql = ""): SqlSheetCell {
  return {
    id: `cell-${crypto.randomUUID()}`,
    sql,
    last_run_at: null,
    last_run_duration_ms: null,
    last_run_successful: null,
    proposed_sql: null,
  };
}

function normalizeCells(cells: SqlSheetCell[]): SqlSheetCell[] {
  if (cells.length === 0) {
    return [createEmptyCell()];
  }
  return cells;
}

function pickSelectedCellId(cells: SqlSheetCell[], selectedCellId: string | null): string | null {
  if (cells.length === 0) return null;
  if (selectedCellId && cells.some((c) => c.id === selectedCellId)) {
    return selectedCellId;
  }
  return cells[0].id;
}

function toSheetDocument(openScript: OpenScript): SqlSheetDocument {
  return {
    version: SHEET_FORMAT_VERSION,
    selected_cell_id: pickSelectedCellId(openScript.cells, openScript.selectedCellId),
    cells: normalizeCells(openScript.cells),
  };
}

function createEmptyMetadataSnapshot(): ConnectionMetadataSnapshot {
  return {
    schemas: [],
    tablesBySchema: {},
    viewsBySchema: {},
    functionsBySchema: {},
    typesBySchema: {},
    columns: {},
    indexes: {},
    version: 0,
    isLoading: false,
    lastRefreshedAt: null,
  };
}

export const useAppStore = create<AppState>((set, get) => {
  const applyConnectionMetadataToLegacyState = (connectionId: string) => {
    const snapshot = get().metadataByConnection[connectionId];
    if (!snapshot) return;
    set({
      schemas: snapshot.schemas,
      tablesBySchema: snapshot.tablesBySchema,
      viewsBySchema: snapshot.viewsBySchema,
      functionsBySchema: snapshot.functionsBySchema,
      typesBySchema: snapshot.typesBySchema,
      columns: snapshot.columns,
      indexes: snapshot.indexes,
      activeSchema: snapshot.schemas.length > 0 ? snapshot.schemas[0].name : null,
    });
  };

  const bumpConnectionMetadataVersion = (connectionId: string) => {
    set((state) => {
      const existing = state.metadataByConnection[connectionId] ?? createEmptyMetadataSnapshot();
      return {
        metadataByConnection: {
          ...state.metadataByConnection,
          [connectionId]: {
            ...existing,
            version: existing.version + 1,
            lastRefreshedAt: Date.now(),
          },
        },
      };
    });
  };

  return ({
  // Initial state
  connections: [],
  activeConnectionId: null,
  isLoadingConnections: false,

  schemas: [],
  tablesBySchema: {},
  viewsBySchema: {},
  functionsBySchema: {},
  typesBySchema: {},
  columns: {},
  indexes: {},
  activeSchema: null,
  isLoadingSchema: false,
  loadingSchemas: new Set(),

  // Selected schema object
  selectedSchemaObject: null,
  schemaObjectDetails: null,
  isLoadingSchemaObjectDetails: false,

  // Scripts state
  scriptsByConnection: {},
  isScriptsFolderExpanded: true,
  savedResultsByConnection: {},
  isSavedResultsFolderExpanded: true,

  // Tree UI State
  expandedSchemas: new Set(),
  expandedTables: new Set(),
  expandedViews: new Set(),
  expandedIndexFolders: new Set(),
  isDbExpanded: true,

  queryResults: null,
  isExecuting: false,
  executingCell: null,
  queryError: null,
  previewSource: null,
  querySql: null,

  // Query History
  queryHistory: [],

  isConnectionDialogOpen: false,
  editingConnection: null,
  toasts: [],
  isResultsPanelMinimized: false,

  // Open scripts (editor tabs)
  openScripts: [],
  activeScriptId: null,
  openResultTabs: [],
  activeEditorTab: null,
  metadataByConnection: {},

  // Connection actions
  loadConnections: async () => {
    set({ isLoadingConnections: true });
    try {
      const connections = await invoke<ConnectionInfo[]>("list_connections");
      set({ connections, isLoadingConnections: false });
    } catch (error) {
      console.error("Failed to load connections:", error);
      set({ isLoadingConnections: false });
    }
  },

  addConnection: async (request: NewConnectionRequest) => {
    const connection = await invoke<ConnectionInfo>("add_connection", { request });
    set((state) => ({
      connections: [...state.connections, connection],
    }));
    return connection;
  },

  updateConnection: async (connectionId: string, request: NewConnectionRequest) => {
    const connection = await invoke<ConnectionInfo>("update_connection", {
      connectionId,
      request,
    });
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === connectionId ? connection : c
      ),
    }));
  },

  deleteConnection: async (id: string) => {
    await invoke("delete_connection", { connectionId: id });
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      activeConnectionId:
        state.activeConnectionId === id ? null : state.activeConnectionId,
      // Also remove scripts for this connection from memory
      scriptsByConnection: Object.fromEntries(
        Object.entries(state.scriptsByConnection).filter(([key]) => key !== id)
      ),
      savedResultsByConnection: Object.fromEntries(
        Object.entries(state.savedResultsByConnection).filter(([key]) => key !== id)
      ),
      // Close any open scripts for this connection
      openScripts: state.openScripts.filter((s) => s.connectionId !== id),
      openResultTabs: state.openResultTabs.filter((t) => t.connectionId !== id),
    }));
    // Save tabs state since we closed tabs for this connection
    get().saveOpenTabs();
  },

  testConnection: async (request: NewConnectionRequest) => {
    await invoke("test_connection", { request });
  },

  connect: async (id: string) => {
    // Clear any previous errors and results when attempting to connect
    set({ queryError: null, queryResults: null, querySql: null });

    try {
      await invoke("connect", { connectionId: id });
    } catch (error) {
      // Show connection error in results panel
      set({ queryError: `Connection failed: ${error}` });
      throw error; // Re-throw so caller can also handle it
    }
    // Refresh connection status
    await get().loadConnections();
    // Set as active and load schema
    set({
      activeConnectionId: id,
      isDbExpanded: true,
      isScriptsFolderExpanded: true,
      expandedSchemas: new Set(),
      expandedTables: new Set(),
      expandedViews: new Set(),
      expandedIndexFolders: new Set(),
      tablesBySchema: {},
      viewsBySchema: {},
      functionsBySchema: {},
      typesBySchema: {},
      columns: {},
      indexes: {},
      selectedSchemaObject: null,
      schemaObjectDetails: null,
    });
    // Load schemas and scripts in parallel
    await Promise.all([
      get().loadSchemas(),
      get().loadScripts(id),
      get().loadSavedResults(id),
    ]);

    // Eager load tables/views for all schemas (for autocomplete)
    const { schemas } = get();
    await Promise.all(
      schemas.map((schema) => get().loadTablesForSchema(schema.name))
    );

    // Eager load columns for all tables/views (for autocomplete)
    const { tablesBySchema, viewsBySchema } = get();
    const columnLoadPromises: Promise<void>[] = [];
    for (const [schemaName, tables] of Object.entries(tablesBySchema)) {
      for (const table of tables) {
        columnLoadPromises.push(get().loadColumns(table.name, schemaName));
      }
    }
    for (const [schemaName, views] of Object.entries(viewsBySchema)) {
      for (const view of views) {
        columnLoadPromises.push(get().loadColumns(view.name, schemaName));
      }
    }
    // Load columns in parallel - await so autocomplete schema is ready
    await Promise.all(columnLoadPromises);

    // Auto-create a script if none exists
    const { scriptsByConnection } = get();
    const scripts = scriptsByConnection[id] || [];
    if (scripts.length === 0) {
      await get().createScript(id);
    } else {
      // Open the first script
      await get().openScript(id, scripts[0].id);
    }
  },

  disconnect: async (id: string) => {
    await invoke("disconnect", { connectionId: id });
    await get().loadConnections();
    if (get().activeConnectionId === id) {
      set({
        activeConnectionId: null,
        schemas: [],
        tablesBySchema: {},
        viewsBySchema: {},
        functionsBySchema: {},
        typesBySchema: {},
        columns: {},
        indexes: {},
        activeSchema: null,
        expandedSchemas: new Set(),
        expandedTables: new Set(),
        expandedViews: new Set(),
        expandedIndexFolders: new Set(),
        isDbExpanded: true,
        isScriptsFolderExpanded: true,
        selectedSchemaObject: null,
        schemaObjectDetails: null,
      });
    }
  },

  setActiveConnection: (id: string | null) => {
    set({
      activeConnectionId: id,
      expandedSchemas: new Set(),
      expandedTables: new Set(),
      expandedViews: new Set(),
      expandedIndexFolders: new Set(),
      tablesBySchema: {},
      viewsBySchema: {},
      functionsBySchema: {},
      typesBySchema: {},
      columns: {},
      indexes: {},
      isDbExpanded: true,
      isScriptsFolderExpanded: true,
      selectedSchemaObject: null,
      schemaObjectDetails: null,
    });
    if (id) {
      const snapshot = get().metadataByConnection[id];
      if (snapshot && snapshot.schemas.length > 0) {
        applyConnectionMetadataToLegacyState(id);
      } else {
        get().loadSchemas();
      }
      get().loadScripts(id);
      get().loadSavedResults(id);
    }
  },

  // Schema actions
  loadSchemas: async () => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;

    set({ isLoadingSchema: true });
    set((state) => {
      const existing = state.metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();
      return {
        metadataByConnection: {
          ...state.metadataByConnection,
          [activeConnectionId]: {
            ...existing,
            isLoading: true,
          },
        },
      };
    });
    try {
      const schemas = await invoke<SchemaInfo[]>("get_schemas", {
        connectionId: activeConnectionId,
      });
      set((state) => {
        const existing = state.metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();
        return {
          isLoadingSchema: false,
          metadataByConnection: {
            ...state.metadataByConnection,
            [activeConnectionId]: {
              ...existing,
              schemas,
              version: existing.version + 1,
              isLoading: false,
              lastRefreshedAt: Date.now(),
            },
          },
        };
      });
      applyConnectionMetadataToLegacyState(activeConnectionId);

      // Auto-expand and load first schema if only one exists
      if (schemas.length === 1) {
        const schemaName = schemas[0].name;
        set({ expandedSchemas: new Set([schemaName]) });
        get().loadTablesForSchema(schemaName);
      }
    } catch (error) {
      console.error("Failed to load schemas:", error);
      set({ isLoadingSchema: false });
    }
  },

  loadTablesForSchema: async (schema: string) => {
    const { activeConnectionId, loadingSchemas } = get();
    if (!activeConnectionId) return;
    const snapshot = get().metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();

    // Skip if already loaded or currently loading
    if (snapshot.tablesBySchema[schema] || loadingSchemas.has(schema)) return;

    set((state) => ({
      loadingSchemas: new Set([...state.loadingSchemas, schema]),
    }));

    try {
      // Load tables, views, functions, and types in parallel
      const [tables, views, functions, types] = await Promise.all([
        invoke<TableInfo[]>("get_tables", {
          connectionId: activeConnectionId,
          schema: schema,
        }),
        invoke<ViewInfo[]>("get_views", {
          connectionId: activeConnectionId,
          schema: schema,
        }),
        invoke<FunctionInfo[]>("get_functions", {
          connectionId: activeConnectionId,
          schema: schema,
        }),
        invoke<CustomTypeInfo[]>("get_custom_types", {
          connectionId: activeConnectionId,
          schema: schema,
        }),
      ]);
      set((state) => {
        const newLoadingSchemas = new Set(state.loadingSchemas);
        newLoadingSchemas.delete(schema);
        const existing = state.metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();
        return {
          loadingSchemas: newLoadingSchemas,
          metadataByConnection: {
            ...state.metadataByConnection,
            [activeConnectionId]: {
              ...existing,
              tablesBySchema: { ...existing.tablesBySchema, [schema]: tables },
              viewsBySchema: { ...existing.viewsBySchema, [schema]: views },
              functionsBySchema: { ...existing.functionsBySchema, [schema]: functions },
              typesBySchema: { ...existing.typesBySchema, [schema]: types },
              version: existing.version + 1,
              lastRefreshedAt: Date.now(),
            },
          },
        };
      });
      applyConnectionMetadataToLegacyState(activeConnectionId);
    } catch (error) {
      console.error("Failed to load tables:", error);
      set((state) => {
        const newLoadingSchemas = new Set(state.loadingSchemas);
        newLoadingSchemas.delete(schema);
        return { loadingSchemas: newLoadingSchemas };
      });
    }
  },

  loadViewsForSchema: async (schema: string) => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;
    const snapshot = get().metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();

    // Skip if already loaded
    if (snapshot.viewsBySchema[schema]) return;

    try {
      const views = await invoke<ViewInfo[]>("get_views", {
        connectionId: activeConnectionId,
        schema: schema,
      });
      set((state) => ({
        metadataByConnection: {
          ...state.metadataByConnection,
          [activeConnectionId]: {
            ...(state.metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot()),
            viewsBySchema: {
              ...(state.metadataByConnection[activeConnectionId]?.viewsBySchema ?? {}),
              [schema]: views,
            },
            version: (state.metadataByConnection[activeConnectionId]?.version ?? 0) + 1,
            lastRefreshedAt: Date.now(),
          },
        },
      }));
      applyConnectionMetadataToLegacyState(activeConnectionId);
    } catch (error) {
      console.error("Failed to load views:", error);
    }
  },

  loadColumns: async (table: string, schema: string) => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;
    const snapshot = get().metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();

    const key = `${schema}.${table}`;
    // Skip if already loaded
    if (snapshot.columns[key]) return;

    try {
      // Load columns and indexes in parallel
      const [cols, idxs] = await Promise.all([
        invoke<ColumnInfo[]>("get_columns", {
          connectionId: activeConnectionId,
          table,
          schema,
        }),
        // Only load indexes if not already loaded
        snapshot.indexes[key]
          ? Promise.resolve(snapshot.indexes[key])
          : invoke<IndexInfo[]>("get_indexes", {
            connectionId: activeConnectionId,
            table,
            schema,
          }),
      ]);
      set((state) => ({
        metadataByConnection: {
          ...state.metadataByConnection,
          [activeConnectionId]: {
            ...(state.metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot()),
            columns: {
              ...(state.metadataByConnection[activeConnectionId]?.columns ?? {}),
              [key]: cols,
            },
            indexes: {
              ...(state.metadataByConnection[activeConnectionId]?.indexes ?? {}),
              [key]: idxs,
            },
            version: (state.metadataByConnection[activeConnectionId]?.version ?? 0) + 1,
            lastRefreshedAt: Date.now(),
          },
        },
      }));
      applyConnectionMetadataToLegacyState(activeConnectionId);
    } catch (error) {
      console.error("Failed to load columns:", error);
    }
  },

  loadIndexes: async (table: string, schema: string) => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;
    const snapshot = get().metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();

    const key = `${schema}.${table}`;
    // Skip if already loaded
    if (snapshot.indexes[key]) return;

    try {
      const idxs = await invoke<IndexInfo[]>("get_indexes", {
        connectionId: activeConnectionId,
        table,
        schema,
      });
      set((state) => ({
        metadataByConnection: {
          ...state.metadataByConnection,
          [activeConnectionId]: {
            ...(state.metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot()),
            indexes: {
              ...(state.metadataByConnection[activeConnectionId]?.indexes ?? {}),
              [key]: idxs,
            },
            version: (state.metadataByConnection[activeConnectionId]?.version ?? 0) + 1,
            lastRefreshedAt: Date.now(),
          },
        },
      }));
      applyConnectionMetadataToLegacyState(activeConnectionId);
    } catch (error) {
      console.error("Failed to load indexes:", error);
    }
  },

  loadTypesForSchema: async (schema: string) => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;
    const snapshot = get().metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot();

    // Skip if already loaded
    if (snapshot.typesBySchema[schema]) return;

    try {
      const types = await invoke<CustomTypeInfo[]>("get_custom_types", {
        connectionId: activeConnectionId,
        schema: schema,
      });
      set((state) => ({
        metadataByConnection: {
          ...state.metadataByConnection,
          [activeConnectionId]: {
            ...(state.metadataByConnection[activeConnectionId] ?? createEmptyMetadataSnapshot()),
            typesBySchema: {
              ...(state.metadataByConnection[activeConnectionId]?.typesBySchema ?? {}),
              [schema]: types,
            },
            version: (state.metadataByConnection[activeConnectionId]?.version ?? 0) + 1,
            lastRefreshedAt: Date.now(),
          },
        },
      }));
      applyConnectionMetadataToLegacyState(activeConnectionId);
    } catch (error) {
      console.error("Failed to load types:", error);
    }
  },

  setActiveSchema: (schema: string | null) => {
    set({ activeSchema: schema });
  },

  getConnectionMetadataVersion: (connectionId: string) => {
    return get().metadataByConnection[connectionId]?.version ?? 0;
  },

  ensureMetadataReady: async (connectionId: string, timeoutMs = 1500) => {
    const existing = get().metadataByConnection[connectionId];
    if (existing && existing.schemas.length > 0 && !existing.isLoading) {
      return { ready: true, timedOut: false };
    }

    const fetchPromise = (async () => {
      set((state) => ({
        metadataByConnection: {
          ...state.metadataByConnection,
          [connectionId]: {
            ...(state.metadataByConnection[connectionId] ?? createEmptyMetadataSnapshot()),
            isLoading: true,
          },
        },
      }));

      const schemas = await invoke<SchemaInfo[]>("get_schemas", { connectionId });
      const tablesBySchema: Record<string, TableInfo[]> = {};
      const viewsBySchema: Record<string, ViewInfo[]> = {};
      const functionsBySchema: Record<string, FunctionInfo[]> = {};
      const typesBySchema: Record<string, CustomTypeInfo[]> = {};
      const columns: Record<string, ColumnInfo[]> = {};
      const indexes: Record<string, IndexInfo[]> = {};

      for (const schema of schemas) {
        const [tables, views, functions, types] = await Promise.all([
          invoke<TableInfo[]>("get_tables", { connectionId, schema: schema.name }),
          invoke<ViewInfo[]>("get_views", { connectionId, schema: schema.name }),
          invoke<FunctionInfo[]>("get_functions", { connectionId, schema: schema.name }),
          invoke<CustomTypeInfo[]>("get_custom_types", { connectionId, schema: schema.name }),
        ]);
        tablesBySchema[schema.name] = tables;
        viewsBySchema[schema.name] = views;
        functionsBySchema[schema.name] = functions;
        typesBySchema[schema.name] = types;
      }

      const objectsToLoad = [
        ...Object.entries(tablesBySchema).flatMap(([schema, tables]) =>
          tables.map((t) => ({ schema, name: t.name }))
        ),
        ...Object.entries(viewsBySchema).flatMap(([schema, views]) =>
          views.map((v) => ({ schema, name: v.name }))
        ),
      ];

      await Promise.all(
        objectsToLoad.map(async ({ schema, name }) => {
          const key = `${schema}.${name}`;
          const [cols, idxs] = await Promise.all([
            invoke<ColumnInfo[]>("get_columns", { connectionId, schema, table: name }),
            invoke<IndexInfo[]>("get_indexes", { connectionId, schema, table: name }),
          ]);
          columns[key] = cols;
          indexes[key] = idxs;
        })
      );

      set((state) => {
        const current = state.metadataByConnection[connectionId] ?? createEmptyMetadataSnapshot();
        return {
          metadataByConnection: {
            ...state.metadataByConnection,
            [connectionId]: {
              ...current,
              schemas,
              tablesBySchema,
              viewsBySchema,
              functionsBySchema,
              typesBySchema,
              columns,
              indexes,
              version: current.version + 1,
              isLoading: false,
              lastRefreshedAt: Date.now(),
            },
          },
        };
      });

      if (get().activeConnectionId === connectionId) {
        applyConnectionMetadataToLegacyState(connectionId);
      }
      return true;
    })();

    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    });

    const result = await Promise.race([fetchPromise, timeoutPromise]);
    if (result === "timeout") {
      return { ready: false, timedOut: true };
    }
    return { ready: true, timedOut: false };
  },

  refreshConnectionMetadata: async (connectionId: string) => {
    const { activeConnectionId, connections } = get();
    const connection = connections.find((c) => c.id === connectionId);

    if (!connection?.is_connected) {
      get().showToast("error", "Connection is not active");
      return;
    }
    set((state) => ({
      metadataByConnection: {
        ...state.metadataByConnection,
        [connectionId]: {
          ...(state.metadataByConnection[connectionId] ?? createEmptyMetadataSnapshot()),
          schemas: [],
          tablesBySchema: {},
          viewsBySchema: {},
          functionsBySchema: {},
          typesBySchema: {},
          columns: {},
          indexes: {},
          isLoading: false,
        },
      },
    }));
    bumpConnectionMetadataVersion(connectionId);

    if (activeConnectionId === connectionId) {
      set({
        schemas: [],
        tablesBySchema: {},
        viewsBySchema: {},
        functionsBySchema: {},
        typesBySchema: {},
        columns: {},
        indexes: {},
        expandedSchemas: new Set(),
        expandedTables: new Set(),
        expandedViews: new Set(),
        expandedIndexFolders: new Set(),
        isDbExpanded: true,
        selectedSchemaObject: null,
        schemaObjectDetails: null,
      });
    }

    await Promise.all([
      get().ensureMetadataReady(connectionId, 6000),
      get().loadScripts(connectionId),
      get().loadSavedResults(connectionId),
    ]);

    if (activeConnectionId === connectionId) {
      applyConnectionMetadataToLegacyState(connectionId);
    }

    get().showToast("success", "Metadata refreshed");
  },

  selectSchemaObject: async (
    type: "function" | "custom_type",
    name: string,
    schema: string,
    specificName?: string
  ) => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;

    set({
      selectedSchemaObject: { type, name, schema, specificName },
      schemaObjectDetails: null,
      isLoadingSchemaObjectDetails: true,
      // Clear any query results when selecting a schema object
      queryResults: null,
      querySql: null,
      queryError: null,
    });

    if (type === "custom_type") {
      try {
        const details = await invoke<TypeDetailInfo>("get_type_details", {
          connectionId: activeConnectionId,
          typeName: name,
          schema: schema,
        });
        set({
          schemaObjectDetails: details,
          isLoadingSchemaObjectDetails: false,
        });
      } catch (error) {
        console.error("Failed to load type details:", error);
        set({ isLoadingSchemaObjectDetails: false });
        get().showToast("error", `Failed to load type details: ${error}`);
      }
    } else if (type === "function") {
      try {
        const details = await invoke<FunctionDetailInfo>("get_function_details", {
          connectionId: activeConnectionId,
          functionName: name,
          schema: schema,
        });
        set({
          schemaObjectDetails: details,
          isLoadingSchemaObjectDetails: false,
        });
      } catch (error) {
        console.error("Failed to load function details:", error);
        set({ isLoadingSchemaObjectDetails: false });
        get().showToast("error", `Failed to load function details: ${error}`);
      }
    }
  },

  clearSchemaObjectSelection: () => {
    set({
      selectedSchemaObject: null,
      schemaObjectDetails: null,
      isLoadingSchemaObjectDetails: false,
    });
  },

  // Script actions
  loadScripts: async (connectionId: string) => {
    try {
      const scripts = await invoke<ScriptMetadata[]>("list_scripts", { connectionId });
      set((state) => ({
        scriptsByConnection: {
          ...state.scriptsByConnection,
          [connectionId]: scripts,
        },
      }));
    } catch (error) {
      console.error("Failed to load scripts:", error);
    }
  },

  loadSavedResults: async (connectionId: string) => {
    try {
      const savedResults = await invoke<SavedResultMetadata[]>("list_saved_results", { connectionId });
      set((state) => ({
        savedResultsByConnection: {
          ...state.savedResultsByConnection,
          [connectionId]: savedResults,
        },
      }));
    } catch (error) {
      console.error("Failed to load saved results:", error);
    }
  },

  createScript: async (connectionId: string) => {
    const { connections, scriptsByConnection } = get();
    const connection = connections.find((c) => c.id === connectionId);

    if (!connection) {
      console.error("Cannot create script: connection not found");
      return null;
    }

    // Generate name: <connection_name>_<number>
    const existingScripts = scriptsByConnection[connectionId] || [];
    const name = `${connection.name}_${existingScripts.length + 1}`;

    try {
      const script = await invoke<Script>("create_script", { connectionId, name });

      const cells = normalizeCells(script.cells || []);
      const selectedCellId = pickSelectedCellId(cells, script.selected_cell_id);

      // Update scripts list
      set((state) => ({
        scriptsByConnection: {
          ...state.scriptsByConnection,
          [connectionId]: [...(state.scriptsByConnection[connectionId] || []), script],
        },
      }));

      // Open the new script
      const openScript: OpenScript = {
        id: script.id,
        name: script.name,
        connectionId: script.connection_id,
        cells,
        selectedCellId,
        isDirty: false,
      };

      set((state) => ({
        openScripts: [...state.openScripts, openScript],
        activeScriptId: script.id,
        activeEditorTab: { kind: "script", id: script.id },
      }));

      // Save tabs state
      get().saveOpenTabs();

      return script.id;
    } catch (error) {
      console.error("Failed to create script:", error);
      get().showToast("error", `Failed to create SQL sheet: ${error}`);
      return null;
    }
  },

  openScript: async (connectionId: string, scriptId: string) => {
    const { openScripts } = get();

    // Check if already open
    const existing = openScripts.find((s) => s.id === scriptId);
    if (existing) {
      set({ activeScriptId: scriptId, activeEditorTab: { kind: "script", id: scriptId } });
      get().saveOpenTabs();
      return;
    }

    try {
      const script = await invoke<Script>("get_script", { connectionId, scriptId });
      const cells = normalizeCells(script.cells || []);
      const selectedCellId = pickSelectedCellId(cells, script.selected_cell_id);

      const openScript: OpenScript = {
        id: script.id,
        name: script.name,
        connectionId: script.connection_id,
        cells,
        selectedCellId,
        isDirty: false,
      };

      set((state) => ({
        openScripts: [...state.openScripts, openScript],
        activeScriptId: scriptId,
        activeEditorTab: { kind: "script", id: scriptId },
      }));

      // Save tabs state
      get().saveOpenTabs();
    } catch (error) {
      console.error("Failed to open script:", error);
      get().showToast("error", `Failed to open SQL sheet: ${error}`);
    }
  },

  closeScript: (scriptId: string) => {
    const { openScripts, activeScriptId, activeEditorTab } = get();
    const scriptIndex = openScripts.findIndex((s) => s.id === scriptId);
    const newOpenScripts = openScripts.filter((s) => s.id !== scriptId);

    // If closing active script, switch to adjacent one
    let newActiveId: string | null = activeScriptId;
    if (activeScriptId === scriptId) {
      if (newOpenScripts.length === 0) {
        newActiveId = null;
      } else {
        const newIndex = Math.min(scriptIndex, newOpenScripts.length - 1);
        newActiveId = newOpenScripts[newIndex].id;
      }
    }

    set({
      openScripts: newOpenScripts,
      activeScriptId: newActiveId,
      activeEditorTab:
        activeEditorTab?.kind === "script" && activeEditorTab.id === scriptId
          ? (newActiveId ? { kind: "script", id: newActiveId } : null)
          : activeEditorTab,
    });

    // Save tabs state
    get().saveOpenTabs();
  },

  setActiveScript: (scriptId: string) => {
    set({ activeScriptId: scriptId, activeEditorTab: { kind: "script", id: scriptId } });
    get().saveOpenTabs();
  },

  setSelectedScriptCell: (scriptId: string, cellId: string | null) => {
    set((state) => ({
      openScripts: state.openScripts.map((script) => {
        if (script.id !== scriptId) return script;
        return {
          ...script,
          selectedCellId: pickSelectedCellId(script.cells, cellId),
          isDirty: true,
        };
      }),
    }));

    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return;

    invoke("update_script_content", {
      connectionId: script.connectionId,
      scriptId,
      sheet: toSheetDocument(script),
    }).catch((e) => console.error("Failed to persist selected cell:", e));
    get().saveOpenTabs();
  },

  addScriptCell: async (scriptId: string, sql = "", selectNewCell = true) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return null;

    const newCell = createEmptyCell(sql);
    const selectedIndex = script.selectedCellId
      ? script.cells.findIndex((cell) => cell.id === script.selectedCellId)
      : -1;
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : script.cells.length;
    const cells = [...script.cells];
    cells.splice(insertAt, 0, newCell);

    const selectedCellId = selectNewCell
      ? newCell.id
      : pickSelectedCellId(cells, script.selectedCellId);

    const updatedScript: OpenScript = {
      ...script,
      cells,
      selectedCellId,
      isDirty: true,
    };

    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? updatedScript : s
      ),
    }));

    try {
      await invoke("update_script_content", {
        connectionId: script.connectionId,
        scriptId,
        sheet: toSheetDocument(updatedScript),
      });
      get().saveOpenTabs();
      return newCell.id;
    } catch (error) {
      console.error("Failed to add cell:", error);
      get().showToast("error", `Failed to add cell: ${error}`);
      return null;
    }
  },

  updateScriptCellProposal: (scriptId: string, cellId: string, proposedSql: string | null) => {
    set((state) => ({
      openScripts: state.openScripts.map((s) => {
        if (s.id !== scriptId) return s;
        return {
          ...s,
          cells: s.cells.map((c) => (c.id === cellId ? { ...c, proposed_sql: proposedSql } : c)),
        };
      }),
    }));
  },

  acceptScriptCellProposal: (scriptId: string, cellId: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    const cell = script?.cells.find((c) => c.id === cellId);
    if (!cell || cell.proposed_sql == null) return;

    const proposedSql = cell.proposed_sql;
    // Apply changes: clear proposal and update cell SQL
    get().updateScriptCellProposal(scriptId, cellId, null);
    get().updateScriptContent(scriptId, proposedSql);
  },

  rejectScriptCellProposal: (scriptId: string, cellId: string) => {
    get().updateScriptCellProposal(scriptId, cellId, null);
  },

  removeScriptCell: async (scriptId: string, cellId: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return;

    const targetIndex = script.cells.findIndex((cell) => cell.id === cellId);
    if (targetIndex === -1) return;

    const nextCells = script.cells.filter((cell) => cell.id !== cellId);
    const normalizedCells = normalizeCells(nextCells);
    const fallbackSelectedId =
      normalizedCells[Math.max(0, Math.min(targetIndex, normalizedCells.length - 1))]?.id ?? null;
    const selectedCellId =
      script.selectedCellId === cellId
        ? fallbackSelectedId
        : pickSelectedCellId(normalizedCells, script.selectedCellId);

    const updatedScript: OpenScript = {
      ...script,
      cells: normalizedCells,
      selectedCellId,
      isDirty: true,
    };

    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? updatedScript : s
      ),
    }));

    try {
      await invoke("update_script_content", {
        connectionId: script.connectionId,
        scriptId,
        sheet: toSheetDocument(updatedScript),
      });
      get().saveOpenTabs();
    } catch (error) {
      console.error("Failed to remove cell:", error);
      get().showToast("error", `Failed to remove cell: ${error}`);
    }
  },

  updateScriptCellRunMetadata: async (scriptId: string, cellId: string, updates) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return;

    const updatedScript: OpenScript = {
      ...script,
      cells: script.cells.map((cell) =>
        cell.id === cellId ? { ...cell, ...updates } : cell
      ),
      isDirty: true,
    };

    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? updatedScript : s
      ),
    }));

    try {
      await invoke("update_script_content", {
        connectionId: script.connectionId,
        scriptId,
        sheet: toSheetDocument(updatedScript),
      });
    } catch (error) {
      console.error("Failed to persist run metadata:", error);
    }
  },

  executeScriptCell: async (scriptId: string, cellId: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    const cell = script?.cells.find((c) => c.id === cellId);
    if (!script || !cell) return;

    const sql = cell.sql.trim();
    if (!sql) return;

    const runStartedAt = Date.now();
    set({ executingCell: { scriptId, cellId } });

    try {
      await get().executeQueryDirect(script.connectionId, sql);
      const { queryError, queryResults } = get();
      const elapsedMs = Date.now() - runStartedAt;

      await get().updateScriptCellRunMetadata(scriptId, cellId, {
        last_run_at: runStartedAt,
        last_run_duration_ms: queryError ? elapsedMs : (queryResults?.execution_time_ms ?? elapsedMs),
        last_run_successful: !queryError,
      });
    } finally {
      set({ executingCell: null });
    }
  },

  updateScriptContent: (scriptId: string, content: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return;

    const selectedCellId = pickSelectedCellId(script.cells, script.selectedCellId);
    if (!selectedCellId) return;

    const updatedScript: OpenScript = {
      ...script,
      selectedCellId,
      cells: script.cells.map((cell) =>
        cell.id === selectedCellId ? { ...cell, sql: content } : cell
      ),
      isDirty: true,
    };

    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? updatedScript : s
      ),
    }));

    invoke("update_script_content", {
      connectionId: updatedScript.connectionId,
      scriptId,
      sheet: toSheetDocument(updatedScript),
    }).catch((e) => console.error("Failed to save script:", e));
  },

  saveScript: async (scriptId: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return;

    try {
      await invoke("update_script_content", {
        connectionId: script.connectionId,
        scriptId,
        sheet: toSheetDocument(script),
      });

      set((state) => ({
        openScripts: state.openScripts.map((s) =>
          s.id === scriptId ? { ...s, isDirty: false } : s
        ),
      }));
    } catch (error) {
      console.error("Failed to save script:", error);
      get().showToast("error", `Failed to save: ${error}`);
    }
  },

  renameScript: async (scriptId: string, name: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    const connectionId = script?.connectionId;

    if (!connectionId) {
      // Find connectionId from scriptsByConnection
      for (const [connId, scripts] of Object.entries(get().scriptsByConnection)) {
        if (scripts.some((s) => s.id === scriptId)) {
          try {
            await invoke("rename_script", { connectionId: connId, scriptId, newName: name });

            // Update in scriptsByConnection
            set((state) => ({
              scriptsByConnection: {
                ...state.scriptsByConnection,
                [connId]: state.scriptsByConnection[connId].map((s) =>
                  s.id === scriptId ? { ...s, name } : s
                ),
              },
              openScripts: state.openScripts.map((s) =>
                s.id === scriptId ? { ...s, name } : s
              ),
            }));
          } catch (error) {
            console.error("Failed to rename script:", error);
            get().showToast("error", `Failed to rename SQL sheet: ${error}`);
          }
          return;
        }
      }
      return;
    }

    try {
      await invoke("rename_script", { connectionId, scriptId, newName: name });

      // Update in both places
      set((state) => ({
        scriptsByConnection: {
          ...state.scriptsByConnection,
          [connectionId]: (state.scriptsByConnection[connectionId] || []).map((s) =>
            s.id === scriptId ? { ...s, name } : s
          ),
        },
        openScripts: state.openScripts.map((s) =>
          s.id === scriptId ? { ...s, name } : s
        ),
      }));
    } catch (error) {
      console.error("Failed to rename script:", error);
      get().showToast("error", `Failed to rename SQL sheet: ${error}`);
    }
  },

  deleteScript: async (connectionId: string, scriptId: string) => {
    try {
      await invoke("delete_script", { connectionId, scriptId });

      set((state) => ({
        scriptsByConnection: {
          ...state.scriptsByConnection,
          [connectionId]: (state.scriptsByConnection[connectionId] || []).filter(
            (s) => s.id !== scriptId
          ),
        },
        openScripts: state.openScripts.filter((s) => s.id !== scriptId),
        activeScriptId: state.activeScriptId === scriptId ? null : state.activeScriptId,
        activeEditorTab:
          state.activeEditorTab?.kind === "script" && state.activeEditorTab.id === scriptId
            ? null
            : state.activeEditorTab,
      }));

      // Save tabs state
      get().saveOpenTabs();

      get().showToast("success", "SQL sheet deleted");
    } catch (error) {
      console.error("Failed to delete script:", error);
      get().showToast("error", `Failed to delete: ${error}`);
    }
  },

  toggleScriptsFolderExpanded: () => {
    set((state) => ({ isScriptsFolderExpanded: !state.isScriptsFolderExpanded }));
  },

  toggleSavedResultsFolderExpanded: () => {
    set((state) => ({ isSavedResultsFolderExpanded: !state.isSavedResultsFolderExpanded }));
  },

  setActiveResultTab: (tabId: string) => {
    set({ activeEditorTab: { kind: "result", id: tabId } });
    get().saveOpenTabs();
  },

  closeResultTab: (tabId: string) => {
    const { openResultTabs, activeEditorTab, openScripts, activeScriptId } = get();
    const nextResultTabs = openResultTabs.filter((t) => t.id !== tabId);

    let nextActiveEditorTab = activeEditorTab;
    if (activeEditorTab?.kind === "result" && activeEditorTab.id === tabId) {
      if (nextResultTabs.length > 0) {
        nextActiveEditorTab = { kind: "result", id: nextResultTabs[nextResultTabs.length - 1].id };
      } else if (activeScriptId) {
        nextActiveEditorTab = { kind: "script", id: activeScriptId };
      } else if (openScripts.length > 0) {
        nextActiveEditorTab = { kind: "script", id: openScripts[openScripts.length - 1].id };
      } else {
        nextActiveEditorTab = null;
      }
    }

    set({
      openResultTabs: nextResultTabs,
      activeEditorTab: nextActiveEditorTab,
    });
    get().saveOpenTabs();
  },

  popOutResultsToTab: () => {
    const { queryResults, querySql, previewSource, activeConnectionId, openResultTabs, connections } = get();
    if (!queryResults || !activeConnectionId) return;
    const sql = (querySql ?? "").trim();
    if (!sql) {
      get().showToast("error", "No query SQL available for this result");
      return;
    }

    const maxResultIndex = openResultTabs.reduce((max, tab) => {
      const match = /^Result (\d+)$/.exec(tab.name);
      if (!match) return max;
      return Math.max(max, Number(match[1]));
    }, 0);
    const nextIndex = maxResultIndex + 1;
    const tabId = `result-${crypto.randomUUID()}`;
    const connection = connections.find((c) => c.id === activeConnectionId);
    const now = Date.now();
    const tab: ResultTabData = {
      id: tabId,
      name: `Result ${nextIndex}`,
      connectionId: activeConnectionId,
      sqlCell: { id: `${tabId}-cell`, sql, proposed_sql: null },
      queryResults,
      lastExecutedAt: now,
      lastExecutedDatabase: connection?.database ?? null,
      previewSource: previewSource ?? null,
      resultSource: "live",
      savedResultId: null,
      isQueryCollapsed: true,
      isStale: false,
      isDirty: true,
      version: 1,
      createdAt: now,
    };

    set((state) => ({
      openResultTabs: [...state.openResultTabs, tab],
      activeEditorTab: { kind: "result", id: tabId },
    }));
    get().saveOpenTabs();
  },

  updateResultTabSql: (tabId: string, sql: string) => {
    set((state) => ({
      openResultTabs: state.openResultTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              sqlCell: { ...tab.sqlCell, sql, proposed_sql: null },
              isDirty: true,
              version: tab.version + 1,
            }
          : tab
      ),
    }));
  },

  updateResultTabProposal: (tabId: string, proposedSql: string | null) => {
    set((state) => ({
      openResultTabs: state.openResultTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              sqlCell: { ...tab.sqlCell, proposed_sql: proposedSql },
            }
          : tab
      ),
    }));
  },

  acceptResultTabProposal: (tabId: string) => {
    const tab = get().openResultTabs.find((t) => t.id === tabId);
    const proposed = tab?.sqlCell.proposed_sql;
    if (!tab || proposed == null) return;
    set((state) => ({
      openResultTabs: state.openResultTabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              sqlCell: {
                ...t.sqlCell,
                sql: proposed,
                proposed_sql: null,
              },
              isDirty: true,
              version: t.version + 1,
            }
          : t
      ),
    }));
  },

  rejectResultTabProposal: (tabId: string) => {
    get().updateResultTabProposal(tabId, null);
  },

  toggleResultQueryExpanded: (tabId: string) => {
    set((state) => ({
      openResultTabs: state.openResultTabs.map((tab) =>
        tab.id === tabId ? { ...tab, isQueryCollapsed: !tab.isQueryCollapsed } : tab
      ),
    }));
  },

  saveCurrentResults: async () => {
    const {
      queryResults,
      activeConnectionId,
      previewSource,
      openResultTabs,
      activeEditorTab,
      querySql,
    } = get();
    if (!activeConnectionId) return;

    const activeResultTab =
      activeEditorTab?.kind === "result"
        ? openResultTabs.find((tab) => tab.id === activeEditorTab.id)
        : null;
    const sql = (activeResultTab?.sqlCell.sql ?? querySql ?? "").trim();
    const resultsToSave = activeResultTab?.queryResults ?? queryResults;
    if (!resultsToSave) {
      get().showToast("error", "No result data available to save");
      return;
    }
    if (!sql) {
      get().showToast("error", "No SQL available to save");
      return;
    }

    try {
      const saved = await invoke<SavedResultRecord>("save_saved_result", {
        connectionId: activeConnectionId,
        request: {
          id: activeResultTab?.savedResultId ?? null,
          name: activeResultTab?.savedResultId ? activeResultTab.name : null,
          sql,
          preview_source: activeResultTab?.previewSource ?? previewSource ?? null,
          query_result: resultsToSave,
        },
      });

      set((state) => ({
        savedResultsByConnection: {
          ...state.savedResultsByConnection,
          [activeConnectionId]: [
            saved,
            ...(state.savedResultsByConnection[activeConnectionId] || []).filter((r) => r.id !== saved.id),
          ],
        },
        openResultTabs: state.openResultTabs.map((tab) =>
          activeResultTab && tab.id === activeResultTab.id
            ? {
                ...tab,
                name: saved.name,
                savedResultId: saved.id,
                resultSource: "saved",
                queryResults: saved.query_result,
                previewSource: saved.preview_source ?? null,
                isDirty: false,
              }
            : tab
        ),
      }));

      get().showToast("success", "Result saved");
      get().saveOpenTabs();
    } catch (error) {
      console.error("Failed to save result:", error);
      get().showToast("error", `Failed to save result: ${error}`);
    }
  },

  openSavedResult: async (connectionId: string, savedResultId: string) => {
    try {
      const saved = await invoke<SavedResultRecord>("get_saved_result", {
        connectionId,
        savedResultId,
      });
      const connection = get().connections.find((c) => c.id === connectionId);

      const tabId = `result-${saved.id}`;
      const tab: ResultTabData = {
        id: tabId,
        name: saved.name,
        connectionId,
        sqlCell: { id: `${tabId}-cell`, sql: saved.sql, proposed_sql: null },
        queryResults: saved.query_result,
        lastExecutedAt: saved.updated_at,
        lastExecutedDatabase: connection?.database ?? null,
        previewSource: saved.preview_source,
        resultSource: "saved",
        savedResultId: saved.id,
        isQueryCollapsed: true,
        isStale: false,
        isDirty: false,
        version: 1,
        createdAt: saved.created_at,
      };

      set((state) => ({
        openResultTabs: state.openResultTabs.some((t) => t.id === tabId)
          ? state.openResultTabs.map((t) => (t.id === tabId ? tab : t))
          : [...state.openResultTabs, tab],
        activeEditorTab: { kind: "result", id: tabId },
      }));
      get().saveOpenTabs();
    } catch (error) {
      console.error("Failed to open saved result:", error);
      get().showToast("error", `Failed to open saved result: ${error}`);
    }
  },

  refreshResultTab: async (tabId: string) => {
    const state = get();
    const tab = state.openResultTabs.find((t) => t.id === tabId);
    if (!tab) return;
    const sql = tab.sqlCell.sql.trim();
    if (!sql) return;
    const connection = state.connections.find((c) => c.id === tab.connectionId);
    const now = Date.now();

    set({ isExecuting: true, queryError: null });
    try {
      const queryResult = await invoke<QueryResult>("execute_query", {
        connectionId: tab.connectionId,
        sql,
      });

      set((state) => ({
        openResultTabs: state.openResultTabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                queryResults: queryResult,
                lastExecutedAt: now,
                lastExecutedDatabase: connection?.database ?? tab.lastExecutedDatabase ?? null,
                isStale: false,
                isDirty: true,
                version: t.version + 1,
              }
            : t
        ),
        queryResults: queryResult,
        querySql: sql,
        previewSource: tab.previewSource,
        isExecuting: false,
      }));
    } catch (error) {
      console.error("Failed to refresh result tab:", error);
      set({ isExecuting: false, queryError: String(error), querySql: null });
      get().showToast("error", `Failed to refresh result: ${error}`);
    }
  },

  deleteSavedResult: async (connectionId: string, savedResultId: string) => {
    try {
      await invoke("delete_saved_result", { connectionId, savedResultId });
      set((state) => ({
        savedResultsByConnection: {
          ...state.savedResultsByConnection,
          [connectionId]: (state.savedResultsByConnection[connectionId] || []).filter((r) => r.id !== savedResultId),
        },
        openResultTabs: state.openResultTabs.filter((tab) => tab.savedResultId !== savedResultId),
      }));
    } catch (error) {
      console.error("Failed to delete saved result:", error);
      get().showToast("error", `Failed to delete saved result: ${error}`);
    }
  },

  renameSavedResult: async (connectionId: string, savedResultId: string, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    try {
      const updated = await invoke<SavedResultMetadata>("rename_saved_result", {
        connectionId,
        savedResultId,
        newName: trimmedName,
      });

      set((state) => ({
        savedResultsByConnection: {
          ...state.savedResultsByConnection,
          [connectionId]: (state.savedResultsByConnection[connectionId] || []).map((r) =>
            r.id === savedResultId ? updated : r
          ),
        },
        openResultTabs: state.openResultTabs.map((tab) =>
          tab.savedResultId === savedResultId ? { ...tab, name: updated.name } : tab
        ),
      }));

      get().saveOpenTabs();
    } catch (error) {
      console.error("Failed to rename saved result:", error);
      get().showToast("error", `Failed to rename saved result: ${error}`);
    }
  },

  // Tabs persistence actions
  loadOpenTabs: async () => {
    try {
      const tabsState = await invoke<{
        tabs: Array<{
          id: string;
          name: string;
          kind?: "script" | "result";
          script_id?: string | null;
          saved_result_id?: string | null;
          content: string;
          connection_id: string;
          is_dirty: boolean;
          is_query_collapsed?: boolean;
          last_executed_at?: number | null;
          last_executed_database?: string | null;
          created_at: number;
        }>;
        active_tab_id: string | null;
      }>("load_tabs");

      if (tabsState.tabs.length > 0) {
        const openScripts: OpenScript[] = [];
        const openResultTabs: ResultTabData[] = [];

        for (const tab of tabsState.tabs) {
          const kind = tab.kind ?? "script";
          if (kind === "result") {
            const savedResultId = tab.saved_result_id ?? null;
            const tabId = tab.id;
            if (savedResultId) {
              try {
                const saved = await invoke<SavedResultRecord>("get_saved_result", {
                  connectionId: tab.connection_id,
                  savedResultId,
                });
                openResultTabs.push({
                  id: tabId,
                  name: saved.name,
                  connectionId: tab.connection_id,
                  sqlCell: { id: `${tabId}-cell`, sql: tab.content || saved.sql, proposed_sql: null },
                  queryResults: saved.query_result,
                  lastExecutedAt: tab.last_executed_at ?? saved.updated_at,
                  lastExecutedDatabase:
                    tab.last_executed_database ??
                    get().connections.find((c) => c.id === tab.connection_id)?.database ??
                    null,
                  previewSource: saved.preview_source,
                  resultSource: "saved",
                  savedResultId,
                  isQueryCollapsed: tab.is_query_collapsed ?? true,
                  isStale: false,
                  isDirty: tab.is_dirty ?? false,
                  version: 1,
                  createdAt: tab.created_at,
                });
                continue;
              } catch {
                // fallthrough
              }
            }

            openResultTabs.push({
              id: tabId,
              name: tab.name,
              connectionId: tab.connection_id,
              sqlCell: { id: `${tabId}-cell`, sql: tab.content || "", proposed_sql: null },
              queryResults: null,
              lastExecutedAt: tab.last_executed_at ?? null,
              lastExecutedDatabase: tab.last_executed_database ?? null,
              previewSource: null,
              resultSource: savedResultId ? "saved" : "live",
              savedResultId,
              isQueryCollapsed: tab.is_query_collapsed ?? true,
              isStale: true,
              isDirty: tab.is_dirty ?? true,
              version: 1,
              createdAt: tab.created_at,
            });
            continue;
          }

          try {
            const scriptId = tab.script_id || tab.id;
            const script = await invoke<Script>("get_script", {
              connectionId: tab.connection_id,
              scriptId,
            });
            const cells = normalizeCells(script.cells || []);
            const selectedCellId = pickSelectedCellId(cells, script.selected_cell_id);
            openScripts.push({
              id: script.id,
              name: script.name ?? tab.name,
              cells,
              selectedCellId,
              connectionId: tab.connection_id,
              isDirty: false,
            });
          } catch {
            const fallbackCell = createEmptyCell(tab.content);
            openScripts.push({
              id: tab.id,
              name: tab.name,
              cells: [fallbackCell],
              selectedCellId: fallbackCell.id,
              connectionId: tab.connection_id,
              isDirty: tab.is_dirty,
            });
          }
        }

        const activeTabId = tabsState.active_tab_id;
        let activeEditorTab: ActiveEditorTab = null;
        let activeScriptId: string | null = null;

        if (activeTabId && openResultTabs.some((t) => t.id === activeTabId)) {
          activeEditorTab = { kind: "result", id: activeTabId };
        } else {
          const script = activeTabId
            ? openScripts.find((s) => s.id === activeTabId)
            : openScripts[0];
          if (script) {
            activeScriptId = script.id;
            activeEditorTab = { kind: "script", id: script.id };
          }
        }

        set({
          openScripts,
          openResultTabs,
          activeScriptId,
          activeEditorTab,
        });
      }
    } catch (error) {
      console.error("Failed to load open tabs:", error);
    }
  },

  saveOpenTabs: async () => {
    const { openScripts, openResultTabs, activeEditorTab } = get();

    const tabsState = {
      tabs: [
        ...openScripts.map((script) => ({
          id: script.id,
          script_id: script.id,
          kind: "script",
          saved_result_id: null,
          name: script.name,
          content:
            script.cells.find((cell) => cell.id === script.selectedCellId)?.sql ??
            script.cells[0]?.sql ??
            "",
          connection_id: script.connectionId,
          is_dirty: script.isDirty,
          is_query_collapsed: false,
          created_at: Date.now(),
        })),
        ...openResultTabs.map((tab) => ({
          id: tab.id,
          script_id: null,
          kind: "result",
          saved_result_id: tab.savedResultId,
          name: tab.name,
          content: tab.sqlCell.sql,
          connection_id: tab.connectionId,
          is_dirty: tab.isDirty,
          is_query_collapsed: tab.isQueryCollapsed,
          last_executed_at: tab.lastExecutedAt,
          last_executed_database: tab.lastExecutedDatabase,
          created_at: tab.createdAt,
        })),
      ],
      active_tab_id: activeEditorTab?.id ?? null,
    };

    try {
      await invoke("save_tabs", { state: tabsState });
    } catch (error) {
      console.error("Failed to save open tabs:", error);
    }
  },

  // Tree UI actions
  toggleDbExpanded: () => {
    set((state) => ({ isDbExpanded: !state.isDbExpanded }));
  },

  toggleSchemaExpanded: (schema: string) => {
    const { expandedSchemas, tablesBySchema } = get();
    const newExpanded = new Set(expandedSchemas);

    if (newExpanded.has(schema)) {
      newExpanded.delete(schema);
    } else {
      newExpanded.add(schema);
      // Load tables if not loaded
      if (!tablesBySchema[schema]) {
        get().loadTablesForSchema(schema);
      }
    }

    set({ expandedSchemas: newExpanded });
  },

  toggleTableExpanded: (schema: string, table: string) => {
    const { expandedTables, columns } = get();
    const key = `${schema}.${table}`;
    const newExpanded = new Set(expandedTables);

    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
      // Load columns if not loaded
      if (!columns[key]) {
        get().loadColumns(table, schema);
      }
    }

    set({ expandedTables: newExpanded });
  },

  toggleViewExpanded: (schema: string, view: string) => {
    const { expandedViews, columns } = get();
    const key = `${schema}.${view}`;
    const newExpanded = new Set(expandedViews);

    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
      // Load columns if not loaded (views also have columns)
      if (!columns[key]) {
        get().loadColumns(view, schema);
      }
    }

    set({ expandedViews: newExpanded });
  },

  toggleIndexFolderExpanded: (schema: string, tableOrView: string) => {
    const { expandedIndexFolders, indexes } = get();
    const key = `${schema}.${tableOrView}`;
    const newExpanded = new Set(expandedIndexFolders);

    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
      // Load indexes if not loaded
      if (!indexes[key]) {
        get().loadIndexes(tableOrView, schema);
      }
    }

    set({ expandedIndexFolders: newExpanded });
  },

  // Query actions
  executeQuery: async (sql: string) => {
    const { openScripts, activeScriptId, connections } = get();
    const activeScript = openScripts.find((s) => s.id === activeScriptId);
    const connectionId = activeScript?.connectionId;

    if (!connectionId) {
      set({ queryError: "No active connection" });
      return;
    }

    // Check if connection is active
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) {
      set({ queryError: "Connection not found" });
      return;
    }

    // Auto-connect if not connected
    if (!connection.is_connected) {
      get().showToast("info", `Connecting to ${connection.name}...`);
      try {
        await invoke("connect", { connectionId });
        // Refresh connections to update is_connected status
        await get().loadConnections();
        get().showToast("success", `Connected to ${connection.name}`);
      } catch (error) {
        get().showToast("error", `Failed to connect: ${error}`);
        set({ queryError: `Connection failed: ${error}` });
        return;
      }
    }

    set({ isExecuting: true, queryError: null, selectedSchemaObject: null, previewSource: null });
    const startTime = Date.now();

    try {
      const results = await invoke<QueryResult>("execute_query", {
        connectionId,
        sql,
      });

      // Add to history on success
      const historyEntry: QueryHistoryEntry = {
        id: crypto.randomUUID(),
        sql,
        connectionId,
        connectionName: connection.name,
        timestamp: startTime,
        rowCount: results.row_count,
        executionTimeMs: results.execution_time_ms,
        error: null,
      };

      const newHistory = [historyEntry, ...get().queryHistory].slice(0, 50);
      set({
        queryResults: results,
        isExecuting: false,
        queryHistory: newHistory,
        querySql: sql,
      });
      // Persist history to disk
      invoke("save_query_history", { entries: newHistory }).catch(console.error);
    } catch (error) {
      // Add to history on error
      const historyEntry: QueryHistoryEntry = {
        id: crypto.randomUUID(),
        sql,
        connectionId,
        connectionName: connection.name,
        timestamp: startTime,
        rowCount: null,
        executionTimeMs: null,
        error: error as string,
      };

      const newHistory = [historyEntry, ...get().queryHistory].slice(0, 50);
      set({
        queryError: error as string,
        isExecuting: false,
        queryResults: null,
        queryHistory: newHistory,
        querySql: null,
      });
      // Persist history to disk
      invoke("save_query_history", { entries: newHistory }).catch(console.error);
    }
  },

  // Execute query directly with a specific connection (for table preview)
  executeQueryDirect: async (connectionId: string, sql: string, previewSource?: string) => {
    const { connections } = get();
    const connection = connections.find((c) => c.id === connectionId);

    if (!connection) {
      set({ queryError: "Connection not found" });
      return;
    }

    // Auto-connect if not connected
    if (!connection.is_connected) {
      get().showToast("info", `Connecting to ${connection.name}...`);
      try {
        await invoke("connect", { connectionId });
        await get().loadConnections();
        get().showToast("success", `Connected to ${connection.name}`);
      } catch (error) {
        get().showToast("error", `Failed to connect: ${error}`);
        set({ queryError: `Connection failed: ${error}` });
        return;
      }
    }

    set({ isExecuting: true, queryError: null, selectedSchemaObject: null, previewSource: previewSource || null });
    const startTime = Date.now();

    try {
      const results = await invoke<QueryResult>("execute_query", {
        connectionId,
        sql,
      });

      // Add to history
      const historyEntry: QueryHistoryEntry = {
        id: crypto.randomUUID(),
        sql,
        connectionId,
        connectionName: connection.name,
        timestamp: startTime,
        rowCount: results.row_count,
        executionTimeMs: results.execution_time_ms,
        error: null,
      };

      const newHistory = [historyEntry, ...get().queryHistory].slice(0, 50);
      set({
        queryResults: results,
        isExecuting: false,
        queryHistory: newHistory,
        querySql: sql,
      });
      // Persist history to disk
      invoke("save_query_history", { entries: newHistory }).catch(console.error);
    } catch (error) {
      const historyEntry: QueryHistoryEntry = {
        id: crypto.randomUUID(),
        sql,
        connectionId,
        connectionName: connection.name,
        timestamp: startTime,
        rowCount: null,
        executionTimeMs: null,
        error: error as string,
      };

      const newHistory = [historyEntry, ...get().queryHistory].slice(0, 50);
      set({
        queryError: error as string,
        isExecuting: false,
        queryResults: null,
        queryHistory: newHistory,
        querySql: null,
      });
      // Persist history to disk
      invoke("save_query_history", { entries: newHistory }).catch(console.error);
    }
  },

  clearResults: () => {
    set({ queryResults: null, queryError: null, querySql: null });
  },

  loadQueryHistory: async () => {
    try {
      const entries = await invoke<QueryHistoryEntry[]>("load_query_history");
      set({ queryHistory: entries });
    } catch (error) {
      console.error("Failed to load query history:", error);
    }
  },

  clearQueryHistory: async () => {
    set({ queryHistory: [] });
    try {
      await invoke("clear_query_history");
    } catch (error) {
      console.error("Failed to clear query history:", error);
    }
  },

  // UI actions
  openConnectionDialog: (connection?: ConnectionInfo) => {
    set({
      isConnectionDialogOpen: true,
      editingConnection: connection ?? null,
    });
  },

  closeConnectionDialog: () => {
    set({
      isConnectionDialogOpen: false,
      editingConnection: null,
    });
  },

  showToast: (type, message) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }],
    }));
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      get().dismissToast(id);
    }, 5000);
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  toggleResultsPanelMinimized: () => {
    set((state) => ({ isResultsPanelMinimized: !state.isResultsPanelMinimized }));
  },
  });
});
