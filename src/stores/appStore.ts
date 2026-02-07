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
  QueryHistoryEntry,
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
  content: string;
  isDirty: boolean;
}

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

  // Scripts (stored as .sql files per connection)
  scriptsByConnection: Record<string, ScriptMetadata[]>; // connectionId -> scripts
  isScriptsFolderExpanded: boolean;

  // Tree UI State
  expandedSchemas: Set<string>;
  expandedTables: Set<string>; // "schema.table" format
  expandedViews: Set<string>; // "schema.view" format
  expandedIndexFolders: Set<string>; // "schema.table" or "schema.view" format
  isDbExpanded: boolean;

  // Query
  queryResults: QueryResult | null;
  isExecuting: boolean;
  queryError: string | null;
  previewSource: string | null; // "schema.table" when previewing a table/view

  // Query History
  queryHistory: QueryHistoryEntry[];

  // UI State
  isConnectionDialogOpen: boolean;
  editingConnection: ConnectionInfo | null;
  toasts: Toast[];

  // Open Scripts (tabs in editor)
  openScripts: OpenScript[];
  activeScriptId: string | null;

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
  selectSchemaObject: (
    type: "function" | "custom_type",
    name: string,
    schema: string,
    specificName?: string
  ) => Promise<void>;
  clearSchemaObjectSelection: () => void;

  // Actions - Scripts
  loadScripts: (connectionId: string) => Promise<void>;
  createScript: (connectionId: string) => Promise<string | null>;
  openScript: (connectionId: string, scriptId: string) => Promise<void>;
  closeScript: (scriptId: string) => void;
  setActiveScript: (scriptId: string) => void;
  updateScriptContent: (scriptId: string, content: string) => void;
  saveScript: (scriptId: string) => Promise<void>;
  renameScript: (scriptId: string, name: string) => Promise<void>;
  deleteScript: (connectionId: string, scriptId: string) => Promise<void>;
  toggleScriptsFolderExpanded: () => void;
  
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
}

export const useAppStore = create<AppState>((set, get) => ({
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

  // Tree UI State
  expandedSchemas: new Set(),
  expandedTables: new Set(),
  expandedViews: new Set(),
  expandedIndexFolders: new Set(),
  isDbExpanded: true,

  queryResults: null,
  isExecuting: false,
  queryError: null,
  previewSource: null,

  // Query History
  queryHistory: [],

  isConnectionDialogOpen: false,
  editingConnection: null,
  toasts: [],

  // Open scripts (editor tabs)
  openScripts: [],
  activeScriptId: null,

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
      // Close any open scripts for this connection
      openScripts: state.openScripts.filter((s) => s.connectionId !== id),
    }));
    // Save tabs state since we closed tabs for this connection
    get().saveOpenTabs();
  },

  testConnection: async (request: NewConnectionRequest) => {
    await invoke("test_connection", { request });
  },

  connect: async (id: string) => {
    // Clear any previous errors and results when attempting to connect
    set({ queryError: null, queryResults: null });
    
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
      get().loadSchemas();
      get().loadScripts(id);
    }
  },

  // Schema actions
  loadSchemas: async () => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;

    set({ isLoadingSchema: true });
    try {
      const schemas = await invoke<SchemaInfo[]>("get_schemas", {
        connectionId: activeConnectionId,
      });
      const activeSchema = schemas.length > 0 ? schemas[0].name : null;
      set({ schemas, activeSchema, isLoadingSchema: false });
      
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
    const { activeConnectionId, tablesBySchema, loadingSchemas } = get();
    if (!activeConnectionId) return;

    // Skip if already loaded or currently loading
    if (tablesBySchema[schema] || loadingSchemas.has(schema)) return;

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
        return {
          tablesBySchema: { ...state.tablesBySchema, [schema]: tables },
          viewsBySchema: { ...state.viewsBySchema, [schema]: views },
          functionsBySchema: { ...state.functionsBySchema, [schema]: functions },
          typesBySchema: { ...state.typesBySchema, [schema]: types },
          loadingSchemas: newLoadingSchemas,
        };
      });
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
    const { activeConnectionId, viewsBySchema } = get();
    if (!activeConnectionId) return;

    // Skip if already loaded
    if (viewsBySchema[schema]) return;

    try {
      const views = await invoke<ViewInfo[]>("get_views", {
        connectionId: activeConnectionId,
        schema: schema,
      });
      set((state) => ({
        viewsBySchema: { ...state.viewsBySchema, [schema]: views },
      }));
    } catch (error) {
      console.error("Failed to load views:", error);
    }
  },

  loadColumns: async (table: string, schema: string) => {
    const { activeConnectionId, columns, indexes } = get();
    if (!activeConnectionId) return;

    const key = `${schema}.${table}`;
    // Skip if already loaded
    if (columns[key]) return;

    try {
      // Load columns and indexes in parallel
      const [cols, idxs] = await Promise.all([
        invoke<ColumnInfo[]>("get_columns", {
          connectionId: activeConnectionId,
          table,
          schema,
        }),
        // Only load indexes if not already loaded
        indexes[key] 
          ? Promise.resolve(indexes[key]) 
          : invoke<IndexInfo[]>("get_indexes", {
              connectionId: activeConnectionId,
              table,
              schema,
            }),
      ]);
      set((state) => ({
        columns: { ...state.columns, [key]: cols },
        indexes: { ...state.indexes, [key]: idxs },
      }));
    } catch (error) {
      console.error("Failed to load columns:", error);
    }
  },

  loadIndexes: async (table: string, schema: string) => {
    const { activeConnectionId, indexes } = get();
    if (!activeConnectionId) return;

    const key = `${schema}.${table}`;
    // Skip if already loaded
    if (indexes[key]) return;

    try {
      const idxs = await invoke<IndexInfo[]>("get_indexes", {
        connectionId: activeConnectionId,
        table,
        schema,
      });
      set((state) => ({
        indexes: { ...state.indexes, [key]: idxs },
      }));
    } catch (error) {
      console.error("Failed to load indexes:", error);
    }
  },

  loadTypesForSchema: async (schema: string) => {
    const { activeConnectionId, typesBySchema } = get();
    if (!activeConnectionId) return;

    // Skip if already loaded
    if (typesBySchema[schema]) return;

    try {
      const types = await invoke<CustomTypeInfo[]>("get_custom_types", {
        connectionId: activeConnectionId,
        schema: schema,
      });
      set((state) => ({
        typesBySchema: { ...state.typesBySchema, [schema]: types },
      }));
    } catch (error) {
      console.error("Failed to load types:", error);
    }
  },

  setActiveSchema: (schema: string | null) => {
    set({ activeSchema: schema });
  },

  refreshConnectionMetadata: async (connectionId: string) => {
    const { activeConnectionId, connections } = get();
    const connection = connections.find((c) => c.id === connectionId);
    
    if (!connection?.is_connected) {
      get().showToast("error", "Connection is not active");
      return;
    }

    // Only refresh if this is the active connection
    if (activeConnectionId !== connectionId) {
      get().setActiveConnection(connectionId);
      return;
    }

    // Clear all cached metadata
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

    // Reload schemas and scripts
    await Promise.all([
      get().loadSchemas(),
      get().loadScripts(connectionId),
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
    // Load columns in parallel
    await Promise.all(columnLoadPromises);
    
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
        content: script.content,
        isDirty: false,
      };
      
      set((state) => ({
        openScripts: [...state.openScripts, openScript],
        activeScriptId: script.id,
      }));
      
      // Save tabs state
      get().saveOpenTabs();
      
      return script.id;
    } catch (error) {
      console.error("Failed to create script:", error);
      get().showToast("error", `Failed to create script: ${error}`);
      return null;
    }
  },

  openScript: async (connectionId: string, scriptId: string) => {
    const { openScripts } = get();
    
    // Check if already open
    const existing = openScripts.find((s) => s.id === scriptId);
    if (existing) {
      set({ activeScriptId: scriptId });
      get().saveOpenTabs();
      return;
    }
    
    try {
      const script = await invoke<Script>("get_script", { connectionId, scriptId });
      
      const openScript: OpenScript = {
        id: script.id,
        name: script.name,
        connectionId: script.connection_id,
        content: script.content,
        isDirty: false,
      };
      
      set((state) => ({
        openScripts: [...state.openScripts, openScript],
        activeScriptId: scriptId,
      }));
      
      // Save tabs state
      get().saveOpenTabs();
    } catch (error) {
      console.error("Failed to open script:", error);
      get().showToast("error", `Failed to open script: ${error}`);
    }
  },

  closeScript: (scriptId: string) => {
    const { openScripts, activeScriptId } = get();
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
    });
    
    // Save tabs state
    get().saveOpenTabs();
  },

  setActiveScript: (scriptId: string) => {
    set({ activeScriptId: scriptId });
    get().saveOpenTabs();
  },

  updateScriptContent: (scriptId: string, content: string) => {
    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? { ...s, content, isDirty: true } : s
      ),
    }));
    
    // Auto-save after a short delay (debounced in component)
    // For now, save immediately
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (script) {
      invoke("update_script_content", {
        connectionId: script.connectionId,
        scriptId,
        content,
      }).catch((e) => console.error("Failed to save script:", e));
    }
  },

  saveScript: async (scriptId: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return;
    
    try {
      await invoke("update_script_content", {
        connectionId: script.connectionId,
        scriptId,
        content: script.content,
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
            get().showToast("error", `Failed to rename: ${error}`);
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
      get().showToast("error", `Failed to rename: ${error}`);
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
      }));
      
      // Save tabs state
      get().saveOpenTabs();
      
      get().showToast("success", "Script deleted");
    } catch (error) {
      console.error("Failed to delete script:", error);
      get().showToast("error", `Failed to delete: ${error}`);
    }
  },

  toggleScriptsFolderExpanded: () => {
    set((state) => ({ isScriptsFolderExpanded: !state.isScriptsFolderExpanded }));
  },

  // Tabs persistence actions
  loadOpenTabs: async () => {
    try {
      const tabsState = await invoke<{
        tabs: Array<{
          id: string;
          name: string;
          content: string;
          connection_id: string;
          is_dirty: boolean;
          created_at: number;
        }>;
        active_tab_id: string | null;
      }>("load_tabs");

      if (tabsState.tabs.length > 0) {
        const openScripts: OpenScript[] = tabsState.tabs.map((tab) => ({
          id: tab.id,
          name: tab.name,
          content: tab.content,
          connectionId: tab.connection_id,
          isDirty: tab.is_dirty,
        }));

        set({
          openScripts,
          activeScriptId: tabsState.active_tab_id,
        });
      }
    } catch (error) {
      console.error("Failed to load open tabs:", error);
    }
  },

  saveOpenTabs: async () => {
    const { openScripts, activeScriptId } = get();
    
    const tabsState = {
      tabs: openScripts.map((script) => ({
        id: script.id,
        name: script.name,
        content: script.content,
        connection_id: script.connectionId,
        is_dirty: script.isDirty,
        created_at: Date.now(),
      })),
      active_tab_id: activeScriptId,
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
      });
      // Persist history to disk
      invoke("save_query_history", { entries: newHistory }).catch(console.error);
    }
  },

  clearResults: () => {
    set({ queryResults: null, queryError: null });
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
}));
