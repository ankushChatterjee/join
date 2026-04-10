import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectInfo,
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
  SqlParamDefaults,
  SqlPlaceholderMode,
} from "./types";
import { recordPerfSample } from "@/lib/perf";
import {
  analyzeSqlPlaceholders,
  applySqlParams,
  buildParamCacheKey,
  getParamDefaults,
  setParamDefaults,
  type SqlPlaceholderSpec,
} from "@/lib/sqlParameters";

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
  pendingSaveRevision: number;
  lastFlushedRevision: number;
}

type ActiveEditorTab = { kind: "script" | "result"; id: string } | null;
type EditorTabRef = { kind: "script" | "result"; id: string };
type SavedResultRecord = SavedResultMetadata & { query_result: QueryResult };
type QueryContext = {
  source: "script_cell" | "script" | "result_tab" | "preview";
  connectionId: string;
  connectionName: string;
  sql: string;
  scriptId?: string;
  scriptName?: string;
  cellId?: string;
  cellIndex?: number;
  resultTabId?: string;
  resultTabName?: string;
  previewSource?: string | null;
  capturedAt: number;
};

interface ScriptSaveQueueStatus {
  scriptId: string;
  pendingRevision: number | null;
  lastFlushedRevision: number;
  hasPending: boolean;
}

interface PendingSqlParameterPrompt {
  connectionId: string;
  sql: string;
  spec: SqlPlaceholderSpec;
  values: SqlParamDefaults;
  resolve: (values: SqlParamDefaults | null) => void;
}

interface AppState {
  // Project
  activeProject: ProjectInfo | null;
  recentProjects: ProjectInfo[];
  isRestoringProject: boolean;

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
  lastQueryContext: QueryContext | null;

  // Query History
  queryHistory: QueryHistoryEntry[];
  parameterDefaults: Record<string, SqlParamDefaults>;
  pendingSqlParameterPrompt: PendingSqlParameterPrompt | null;

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
  editorTabOrder: EditorTabRef[];

  // Actions - Connections
  createProject: (parentDir: string, name: string) => Promise<void>;
  openProject: (rootPath: string) => Promise<void>;
  loadRecentProjects: () => Promise<void>;
  restoreLastProject: () => Promise<void>;
  closeProject: () => void;
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
  flushScriptNow: (scriptId: string) => Promise<void>;
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
  reorderEditorTabs: (active: EditorTabRef, over: EditorTabRef) => void;
  reorderOpenScripts: (oldIndex: number, newIndex: number) => void;
  reorderOpenResultTabs: (oldIndex: number, newIndex: number) => void;
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
  executeQueryDirect: (
    connectionId: string,
    sql: string,
    previewSource?: string,
    queryContext?: Omit<QueryContext, "capturedAt">
  ) => Promise<void>;
  getParameterDefaults: (
    connectionId: string,
    sql: string,
    mode: SqlPlaceholderMode,
    spec: SqlPlaceholderSpec
  ) => SqlParamDefaults;
  saveParameterDefaults: (
    connectionId: string,
    sql: string,
    mode: SqlPlaceholderMode,
    values: SqlParamDefaults
  ) => void;
  requestSqlParameters: (
    connectionId: string,
    sql: string,
    spec: SqlPlaceholderSpec
  ) => Promise<SqlParamDefaults | null>;
  submitSqlParameterPrompt: (values: SqlParamDefaults) => void;
  cancelSqlParameterPrompt: () => void;
  resolveSqlWithParameters: (connectionId: string, sql: string) => Promise<string | null>;
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

function findOpenScriptIndexById(openScripts: OpenScript[], scriptId: string): number {
  return openScripts.findIndex((script) => script.id === scriptId);
}

function resolveSelectedCell(
  cells: SqlSheetCell[],
  selectedCellId: string | null
): { id: string; index: number } | null {
  if (cells.length === 0) return null;

  if (selectedCellId) {
    for (let i = 0; i < cells.length; i += 1) {
      if (cells[i].id === selectedCellId) {
        return { id: selectedCellId, index: i };
      }
    }
  }

  return { id: cells[0].id, index: 0 };
}

function updateSelectedCellSql(
  script: OpenScript,
  selectedCellId: string,
  selectedCellIndex: number,
  content: string
): OpenScript {
  if (selectedCellIndex < 0 || selectedCellIndex >= script.cells.length) {
    return script;
  }

  const nextCells = [...script.cells];
  const selectedCell = nextCells[selectedCellIndex];
  nextCells[selectedCellIndex] = { ...selectedCell, sql: content };

  return {
    ...script,
    selectedCellId,
    cells: nextCells,
    isDirty: true,
    pendingSaveRevision: script.pendingSaveRevision + 1,
  };
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

function normalizeEditorTabOrder(
  editorTabOrder: EditorTabRef[],
  openScripts: OpenScript[],
  openResultTabs: ResultTabData[]
): EditorTabRef[] {
  const scriptIds = new Set(openScripts.map((s) => s.id));
  const resultIds = new Set(openResultTabs.map((t) => t.id));
  const normalized: EditorTabRef[] = [];
  const seen = new Set<string>();

  for (const tab of editorTabOrder) {
    const exists =
      tab.kind === "script" ? scriptIds.has(tab.id) : resultIds.has(tab.id);
    if (!exists) continue;
    const key = `${tab.kind}:${tab.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tab);
  }

  for (const script of openScripts) {
    const key = `script:${script.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ kind: "script", id: script.id });
  }

  for (const tab of openResultTabs) {
    const key = `result:${tab.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ kind: "result", id: tab.id });
  }

  return normalized;
}

export const useAppStore = create<AppState>((set, get) => {
  const SCRIPT_AUTOSAVE_IDLE_MS = 750;
  const scriptSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const openScriptIndexCache = new Map<string, number>();
  const selectedCellIndexCache = new Map<string, { id: string; index: number }>();
  const requireProjectRoot = () => {
    const projectRoot = get().activeProject?.rootPath;
    if (!projectRoot) {
      throw new Error("No active project");
    }
    return projectRoot;
  };
  const resetProjectScopedState = () => ({
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
    loadingSchemas: new Set<string>(),
    metadataByConnection: {},
    selectedSchemaObject: null,
    schemaObjectDetails: null,
    isLoadingSchemaObjectDetails: false,
    scriptsByConnection: {},
    isScriptsFolderExpanded: true,
    savedResultsByConnection: {},
    isSavedResultsFolderExpanded: true,
    expandedSchemas: new Set<string>(),
    expandedTables: new Set<string>(),
    expandedViews: new Set<string>(),
    expandedIndexFolders: new Set<string>(),
    isDbExpanded: true,
    queryResults: null,
    isExecuting: false,
    executingCell: null,
    queryError: null,
    previewSource: null,
    querySql: null,
    lastQueryContext: null,
    queryHistory: [],
    parameterDefaults: {},
    pendingSqlParameterPrompt: null,
    openScripts: [],
    activeScriptId: null,
    openResultTabs: [],
    activeEditorTab: null,
    editorTabOrder: [],
  });

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

  const queueScriptPersist = async (script: OpenScript, sheetOverride?: SqlSheetDocument) => {
    try {
      const projectRoot = requireProjectRoot();
      const sheet = sheetOverride ?? toSheetDocument(script);
      await invoke<ScriptSaveQueueStatus>("queue_script_update", {
        projectRoot,
        connectionId: script.connectionId,
        scriptId: script.id,
        sheet,
        revision: script.pendingSaveRevision,
      });
    } catch (error) {
      console.error("Failed to queue script updates:", error);
    }
  };

  const scheduleScriptPersist = (scriptId: string) => {
    const existing = scriptSaveTimers.get(scriptId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(async () => {
      scriptSaveTimers.delete(scriptId);
      await get().flushScriptNow(scriptId);
    }, SCRIPT_AUTOSAVE_IDLE_MS);
    scriptSaveTimers.set(scriptId, timer);
  };

  return ({
  // Initial state
  activeProject: null,
  recentProjects: [],
  isRestoringProject: false,
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
  lastQueryContext: null,

  // Query History
  queryHistory: [],
  parameterDefaults: {},
  pendingSqlParameterPrompt: null,

  isConnectionDialogOpen: false,
  editingConnection: null,
  toasts: [],
  isResultsPanelMinimized: false,

  // Open scripts (editor tabs)
  openScripts: [],
  activeScriptId: null,
  openResultTabs: [],
  activeEditorTab: null,
  editorTabOrder: [],
  metadataByConnection: {},

  createProject: async (parentDir: string, name: string) => {
    const project = await invoke<ProjectInfo>("create_project", { parentDir, name });
    await get().openProject(project.rootPath);
  },

  openProject: async (rootPath: string) => {
    const project = await invoke<ProjectInfo>("open_project", { rootPath });
    set({
      activeProject: project,
      isConnectionDialogOpen: false,
      editingConnection: null,
      ...resetProjectScopedState(),
    });
    void get().loadRecentProjects();
    await Promise.all([
      get().loadConnections(),
      get().loadOpenTabs(),
      get().loadQueryHistory(),
    ]);
  },

  loadRecentProjects: async () => {
    try {
      const recentProjects = await invoke<ProjectInfo[]>("list_recent_projects");
      set({ recentProjects });
    } catch (error) {
      console.error("Failed to load recent projects:", error);
      set({ recentProjects: [] });
    }
  },

  restoreLastProject: async () => {
    if (get().activeProject || get().isRestoringProject) return;
    set({ isRestoringProject: true });
    try {
      const recentProjects = await invoke<ProjectInfo[]>("list_recent_projects");
      set({ recentProjects });
      const lastProject = recentProjects[0];
      if (lastProject) {
        await get().openProject(lastProject.rootPath);
      }
    } catch (error) {
      console.error("Failed to restore last project:", error);
    } finally {
      set({ isRestoringProject: false });
    }
  },

  closeProject: () => {
    set({
      activeProject: null,
      isConnectionDialogOpen: false,
      editingConnection: null,
      ...resetProjectScopedState(),
    });
  },

  // Connection actions
  loadConnections: async () => {
    const projectRoot = get().activeProject?.rootPath;
    if (!projectRoot) {
      set({ connections: [], activeConnectionId: null, isLoadingConnections: false });
      return;
    }
    set({ isLoadingConnections: true });
    try {
      const connections = await invoke<ConnectionInfo[]>("list_connections", { projectRoot });
      set({ connections, isLoadingConnections: false });
    } catch (error) {
      console.error("Failed to load connections:", error);
      set({ isLoadingConnections: false });
    }
  },

  addConnection: async (request: NewConnectionRequest) => {
    const projectRoot = requireProjectRoot();
    const connection = await invoke<ConnectionInfo>("add_connection", { projectRoot, request });
    set((state) => ({
      connections: [...state.connections, connection],
    }));
    return connection;
  },

  updateConnection: async (connectionId: string, request: NewConnectionRequest) => {
    const projectRoot = requireProjectRoot();
    const connection = await invoke<ConnectionInfo>("update_connection", {
      projectRoot,
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
    const projectRoot = requireProjectRoot();
    await invoke("delete_connection", { projectRoot, connectionId: id });
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
    const projectRoot = requireProjectRoot();
    // Clear any previous errors and results when attempting to connect
    set({ queryError: null, queryResults: null, querySql: null, lastQueryContext: null });

    try {
      await invoke("connect", { projectRoot, connectionId: id });
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
    // Load columns/indexes in background so editor becomes interactive faster.
    Promise.all(columnLoadPromises).catch((error) => {
      console.error("Background metadata load failed:", error);
    });

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
    const projectRoot = get().activeProject?.rootPath;
    if (!projectRoot) return;
    try {
      const scripts = await invoke<ScriptMetadata[]>("list_scripts", { projectRoot, connectionId });
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
    const projectRoot = get().activeProject?.rootPath;
    if (!projectRoot) return;
    try {
      const savedResults = await invoke<SavedResultMetadata[]>("list_saved_results", { projectRoot, connectionId });
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
    const projectRoot = requireProjectRoot();
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
      const script = await invoke<Script>("create_script", { projectRoot, connectionId, name });

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
        pendingSaveRevision: 0,
        lastFlushedRevision: 0,
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
    const projectRoot = requireProjectRoot();
    const { openScripts } = get();

    // Check if already open
    const existing = openScripts.find((s) => s.id === scriptId);
    if (existing) {
      set({ activeScriptId: scriptId, activeEditorTab: { kind: "script", id: scriptId } });
      get().saveOpenTabs();
      return;
    }

    try {
      const script = await invoke<Script>("get_script", { projectRoot, connectionId, scriptId });
      const cells = normalizeCells(script.cells || []);
      const selectedCellId = pickSelectedCellId(cells, script.selected_cell_id);

      const openScript: OpenScript = {
        id: script.id,
        name: script.name,
        connectionId: script.connection_id,
        cells,
        selectedCellId,
        isDirty: false,
        pendingSaveRevision: 0,
        lastFlushedRevision: 0,
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
    void get().flushScriptNow(scriptId);
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
    const currentActive = get().activeEditorTab;
    if (currentActive?.kind === "script" && currentActive.id !== scriptId) {
      void get().flushScriptNow(currentActive.id);
    }
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
        };
      }),
    }));
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
      pendingSaveRevision: script.pendingSaveRevision + 1,
    };

    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? updatedScript : s
      ),
    }));

    void queueScriptPersist(updatedScript);
    scheduleScriptPersist(scriptId);
    get().saveOpenTabs();
    return newCell.id;
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
      pendingSaveRevision: script.pendingSaveRevision + 1,
    };

    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? updatedScript : s
      ),
    }));

    void queueScriptPersist(updatedScript);
    scheduleScriptPersist(scriptId);
    get().saveOpenTabs();
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
      pendingSaveRevision: script.pendingSaveRevision + 1,
    };

    set((state) => ({
      openScripts: state.openScripts.map((s) =>
        s.id === scriptId ? updatedScript : s
      ),
    }));

    void queueScriptPersist(updatedScript);
    await get().flushScriptNow(scriptId);
  },

  executeScriptCell: async (scriptId: string, cellId: string) => {
    await get().flushScriptNow(scriptId);
    const script = get().openScripts.find((s) => s.id === scriptId);
    const cell = script?.cells.find((c) => c.id === cellId);
    if (!script || !cell) return;

    const sql = cell.sql.trim();
    if (!sql) return;

    const runStartedAt = Date.now();
    set({ executingCell: { scriptId, cellId } });

    try {
      const connection = get().connections.find((c) => c.id === script.connectionId);
      const cellIndex = script.cells.findIndex((c) => c.id === cellId);
      await get().executeQueryDirect(
        script.connectionId,
        sql,
        undefined,
        {
          source: "script_cell",
          connectionId: script.connectionId,
          connectionName: connection?.name ?? script.connectionId,
          sql,
          scriptId: script.id,
          scriptName: script.name,
          cellId,
          cellIndex: cellIndex >= 0 ? cellIndex + 1 : undefined,
        }
      );
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
    const { openScripts } = get();
    let scriptIndex = openScriptIndexCache.get(scriptId) ?? -1;
    if (
      scriptIndex < 0 ||
      scriptIndex >= openScripts.length ||
      openScripts[scriptIndex].id !== scriptId
    ) {
      scriptIndex = findOpenScriptIndexById(openScripts, scriptId);
      if (scriptIndex >= 0) {
        openScriptIndexCache.set(scriptId, scriptIndex);
      } else {
        openScriptIndexCache.delete(scriptId);
      }
    }
    if (scriptIndex < 0) return;
    const script = openScripts[scriptIndex];

    let selectedCell = selectedCellIndexCache.get(script.id) ?? null;
    if (selectedCell) {
      const { index, id } = selectedCell;
      if (
        index < 0 ||
        index >= script.cells.length ||
        script.cells[index]?.id !== id ||
        (script.selectedCellId && script.selectedCellId !== id)
      ) {
        selectedCell = null;
      }
    }

    if (!selectedCell) {
      selectedCell = resolveSelectedCell(script.cells, script.selectedCellId);
      if (!selectedCell) return;
      selectedCellIndexCache.set(script.id, selectedCell);
    }

    if (!selectedCell) return;

    const updatedScript = updateSelectedCellSql(
      script,
      selectedCell.id,
      selectedCell.index,
      content
    );
    if (updatedScript === script) return;

    const nextOpenScripts = [...openScripts];
    nextOpenScripts[scriptIndex] = updatedScript;
    set({ openScripts: nextOpenScripts });

    const sheetForQueue: SqlSheetDocument = {
      version: SHEET_FORMAT_VERSION,
      selected_cell_id: updatedScript.selectedCellId,
      cells: updatedScript.cells,
    };
    queueMicrotask(() => {
      void queueScriptPersist(updatedScript, sheetForQueue);
      scheduleScriptPersist(scriptId);
    });
  },

  flushScriptNow: async (scriptId: string) => {
    requireProjectRoot();
    const timer = scriptSaveTimers.get(scriptId);
    if (timer) {
      clearTimeout(timer);
      scriptSaveTimers.delete(scriptId);
    }
    try {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const status = await invoke<ScriptSaveQueueStatus | undefined>("flush_script_updates", { scriptId });
      const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      recordPerfSample("script.flush_ms", endedAt - startedAt);
      const safeStatus: ScriptSaveQueueStatus = status ?? {
        scriptId,
        pendingRevision: null,
        lastFlushedRevision: 0,
        hasPending: false,
      };
      set((state) => ({
        openScripts: state.openScripts.map((s) =>
          s.id === scriptId
            ? {
                ...s,
                lastFlushedRevision: Math.max(s.lastFlushedRevision, safeStatus.lastFlushedRevision),
                isDirty: safeStatus.lastFlushedRevision < s.pendingSaveRevision,
              }
            : s
        ),
      }));
    } catch (error) {
      console.error("Failed to flush script updates:", error);
      get().showToast("error", `Autosave failed: ${error}`);
    }
  },

  saveScript: async (scriptId: string) => {
    const script = get().openScripts.find((s) => s.id === scriptId);
    if (!script) return;

    try {
      await get().flushScriptNow(scriptId);

      set((state) => ({
        openScripts: state.openScripts.map((s) =>
          s.id === scriptId
            ? { ...s, isDirty: false, lastFlushedRevision: s.pendingSaveRevision }
            : s
        ),
      }));
    } catch (error) {
      console.error("Failed to save script:", error);
      get().showToast("error", `Failed to save: ${error}`);
    }
  },

  renameScript: async (scriptId: string, name: string) => {
    const projectRoot = requireProjectRoot();
    const script = get().openScripts.find((s) => s.id === scriptId);
    const connectionId = script?.connectionId;

    if (!connectionId) {
      // Find connectionId from scriptsByConnection
      for (const [connId, scripts] of Object.entries(get().scriptsByConnection)) {
        if (scripts.some((s) => s.id === scriptId)) {
          try {
            await invoke("rename_script", { projectRoot, connectionId: connId, scriptId, newName: name });

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
      await invoke("rename_script", { projectRoot, connectionId, scriptId, newName: name });

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
    const projectRoot = requireProjectRoot();
    try {
      await invoke("delete_script", { projectRoot, connectionId, scriptId });

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
    const currentActive = get().activeEditorTab;
    if (currentActive?.kind === "script") {
      void get().flushScriptNow(currentActive.id);
    }
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
      editorTabOrder: normalizeEditorTabOrder(
        get().editorTabOrder,
        openScripts,
        nextResultTabs
      ),
    });
    if (nextActiveEditorTab?.kind === "script") {
      void get().flushScriptNow(nextActiveEditorTab.id);
    }
    get().saveOpenTabs();
  },

  reorderEditorTabs: (active: EditorTabRef, over: EditorTabRef) => {
    const { editorTabOrder, openScripts, openResultTabs } = get();
    const nextOrder = normalizeEditorTabOrder(editorTabOrder, openScripts, openResultTabs);
    const activeIndex = nextOrder.findIndex(
      (tab) => tab.kind === active.kind && tab.id === active.id
    );
    const overIndex = nextOrder.findIndex(
      (tab) => tab.kind === over.kind && tab.id === over.id
    );
    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return;

    const reordered = [...nextOrder];
    const [moved] = reordered.splice(activeIndex, 1);
    reordered.splice(overIndex, 0, moved);
    set({ editorTabOrder: reordered });
    get().saveOpenTabs();
  },

  reorderOpenScripts: (oldIndex: number, newIndex: number) => {
    const { openScripts } = get();
    if (oldIndex < 0 || oldIndex >= openScripts.length || newIndex < 0 || newIndex >= openScripts.length) {
      return;
    }
    const newOpenScripts = [...openScripts];
    const [movedScript] = newOpenScripts.splice(oldIndex, 1);
    newOpenScripts.splice(newIndex, 0, movedScript);
    set({ openScripts: newOpenScripts });
    get().saveOpenTabs();
  },

  reorderOpenResultTabs: (oldIndex: number, newIndex: number) => {
    const { openResultTabs } = get();
    if (oldIndex < 0 || oldIndex >= openResultTabs.length || newIndex < 0 || newIndex >= openResultTabs.length) {
      return;
    }
    const newOpenResultTabs = [...openResultTabs];
    const [movedTab] = newOpenResultTabs.splice(oldIndex, 1);
    newOpenResultTabs.splice(newIndex, 0, movedTab);
    set({ openResultTabs: newOpenResultTabs });
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
    const projectRoot = requireProjectRoot();
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
        projectRoot,
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
    const projectRoot = requireProjectRoot();
    try {
      const saved = await invoke<SavedResultRecord>("get_saved_result", {
        projectRoot,
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
    const sqlForExecution = await get().resolveSqlWithParameters(tab.connectionId, sql);
    if (!sqlForExecution) return;
    const connection = state.connections.find((c) => c.id === tab.connectionId);
    const now = Date.now();

    set({
      isExecuting: true,
      queryError: null,
      lastQueryContext: {
        source: "result_tab",
        connectionId: tab.connectionId,
        connectionName: connection?.name ?? tab.connectionId,
        sql,
        resultTabId: tab.id,
        resultTabName: tab.name,
        previewSource: tab.previewSource,
        capturedAt: Date.now(),
      },
    });
    try {
      const queryResult = await invoke<QueryResult>("execute_query", {
        connectionId: tab.connectionId,
        sql: sqlForExecution,
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
    const projectRoot = requireProjectRoot();
    try {
      await invoke("delete_saved_result", { projectRoot, connectionId, savedResultId });
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
    const projectRoot = requireProjectRoot();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    try {
      const updated = await invoke<SavedResultMetadata>("rename_saved_result", {
        projectRoot,
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
    const projectRoot = get().activeProject?.rootPath;
    if (!projectRoot) {
      set({ openScripts: [], openResultTabs: [], activeScriptId: null, activeEditorTab: null, editorTabOrder: [] });
      return;
    }
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
      }>("load_tabs", { projectRoot });

      if (tabsState.tabs.length > 0) {
        const openScripts: OpenScript[] = [];
        const openResultTabs: ResultTabData[] = [];
        const loadedOrder: EditorTabRef[] = [];

        for (const tab of tabsState.tabs) {
          const kind = tab.kind ?? "script";
          if (kind === "result") {
            const savedResultId = tab.saved_result_id ?? null;
            const tabId = tab.id;
            if (savedResultId) {
              try {
                const saved = await invoke<SavedResultRecord>("get_saved_result", {
                  projectRoot,
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
                loadedOrder.push({ kind: "result", id: tabId });
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
            loadedOrder.push({ kind: "result", id: tabId });
            continue;
          }

          try {
            const scriptId = tab.script_id || tab.id;
            const script = await invoke<Script>("get_script", {
              projectRoot,
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
              pendingSaveRevision: 0,
              lastFlushedRevision: 0,
            });
            loadedOrder.push({ kind: "script", id: script.id });
          } catch {
            const fallbackCell = createEmptyCell(tab.content);
            openScripts.push({
              id: tab.id,
              name: tab.name,
              cells: [fallbackCell],
              selectedCellId: fallbackCell.id,
              connectionId: tab.connection_id,
              isDirty: tab.is_dirty,
              pendingSaveRevision: tab.is_dirty ? 1 : 0,
              lastFlushedRevision: 0,
            });
            loadedOrder.push({ kind: "script", id: tab.id });
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
          editorTabOrder: normalizeEditorTabOrder(loadedOrder, openScripts, openResultTabs),
        });
      }
    } catch (error) {
      console.error("Failed to load open tabs:", error);
    }
  },

  saveOpenTabs: async () => {
    const projectRoot = get().activeProject?.rootPath;
    if (!projectRoot) return;
    const { openScripts, openResultTabs, activeEditorTab, editorTabOrder } = get();
    const orderedTabs = normalizeEditorTabOrder(editorTabOrder, openScripts, openResultTabs);
    const scriptsById = new Map(openScripts.map((script) => [script.id, script]));
    const resultsById = new Map(openResultTabs.map((tab) => [tab.id, tab]));
    const serializedTabs: Array<{
      id: string;
      script_id: string | null;
      kind: "script" | "result";
      saved_result_id: string | null;
      name: string;
      content: string;
      connection_id: string;
      is_dirty: boolean;
      is_query_collapsed: boolean;
      last_executed_at?: number | null;
      last_executed_database?: string | null;
      created_at: number;
    }> = [];

    for (const tabRef of orderedTabs) {
      if (tabRef.kind === "script") {
        const script = scriptsById.get(tabRef.id);
        if (!script) continue;
        serializedTabs.push({
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
        });
        continue;
      }

      const resultTab = resultsById.get(tabRef.id);
      if (!resultTab) continue;
      serializedTabs.push({
        id: resultTab.id,
        script_id: null,
        kind: "result",
        saved_result_id: resultTab.savedResultId,
        name: resultTab.name,
        content: resultTab.sqlCell.sql,
        connection_id: resultTab.connectionId,
        is_dirty: resultTab.isDirty,
        is_query_collapsed: resultTab.isQueryCollapsed,
        last_executed_at: resultTab.lastExecutedAt,
        last_executed_database: resultTab.lastExecutedDatabase,
        created_at: resultTab.createdAt,
      });
    }

    const tabsState = {
      tabs: serializedTabs,
      active_tab_id: activeEditorTab?.id ?? null,
    };

    try {
      await invoke("save_tabs", { projectRoot, state: tabsState });
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
        await invoke("connect", { projectRoot: requireProjectRoot(), connectionId });
        // Refresh connections to update is_connected status
        await get().loadConnections();
        get().showToast("success", `Connected to ${connection.name}`);
      } catch (error) {
        get().showToast("error", `Failed to connect: ${error}`);
        set({ queryError: `Connection failed: ${error}` });
        return;
      }
    }

    const sqlForExecution = await get().resolveSqlWithParameters(connectionId, sql);
    if (!sqlForExecution) {
      return;
    }

    const selectedCell = activeScript?.selectedCellId
      ? activeScript.cells.find((cell) => cell.id === activeScript.selectedCellId)
      : null;
    const selectedCellIndex =
      selectedCell && activeScript
        ? activeScript.cells.findIndex((cell) => cell.id === selectedCell.id) + 1
        : undefined;

    set({
      isExecuting: true,
      queryError: null,
      selectedSchemaObject: null,
      previewSource: null,
      lastQueryContext: {
        source: selectedCell ? "script_cell" : "script",
        connectionId,
        connectionName: connection.name,
        sql,
        scriptId: activeScript?.id,
        scriptName: activeScript?.name,
        cellId: selectedCell?.id,
        cellIndex: selectedCellIndex && selectedCellIndex > 0 ? selectedCellIndex : undefined,
        capturedAt: Date.now(),
      },
    });
    const startTime = Date.now();

    try {
      const results = await invoke<QueryResult>("execute_query", {
        connectionId,
        sql: sqlForExecution,
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
      invoke("save_query_history", { projectRoot: requireProjectRoot(), entries: newHistory }).catch(console.error);
    } catch (error) {
      const errorMessage = String(error);
      // Add to history on error
      const historyEntry: QueryHistoryEntry = {
        id: crypto.randomUUID(),
        sql,
        connectionId,
        connectionName: connection.name,
        timestamp: startTime,
        rowCount: null,
        executionTimeMs: null,
        error: errorMessage,
      };

      const newHistory = [historyEntry, ...get().queryHistory].slice(0, 50);
      set({
        queryError: errorMessage,
        isExecuting: false,
        queryResults: null,
        queryHistory: newHistory,
        querySql: null,
      });
      // Persist history to disk
      invoke("save_query_history", { projectRoot: requireProjectRoot(), entries: newHistory }).catch(console.error);
    }
  },

  // Execute query directly with a specific connection (for table preview)
  executeQueryDirect: async (
    connectionId: string,
    sql: string,
    previewSource?: string,
    queryContext?: Omit<QueryContext, "capturedAt">
  ) => {
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
        await invoke("connect", { projectRoot: requireProjectRoot(), connectionId });
        await get().loadConnections();
        get().showToast("success", `Connected to ${connection.name}`);
      } catch (error) {
        get().showToast("error", `Failed to connect: ${error}`);
        set({ queryError: `Connection failed: ${error}` });
        return;
      }
    }

    const sqlForExecution = await get().resolveSqlWithParameters(connectionId, sql);
    if (!sqlForExecution) {
      return;
    }

    set({
      isExecuting: true,
      queryError: null,
      selectedSchemaObject: null,
      previewSource: previewSource || null,
      lastQueryContext: queryContext
        ? { ...queryContext, capturedAt: Date.now() }
        : {
            source: previewSource ? "preview" : "script",
            connectionId,
            connectionName: connection.name,
            sql,
            previewSource: previewSource || null,
            capturedAt: Date.now(),
          },
    });
    const startTime = Date.now();

    try {
      const results = await invoke<QueryResult>("execute_query", {
        connectionId,
        sql: sqlForExecution,
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
      invoke("save_query_history", { projectRoot: requireProjectRoot(), entries: newHistory }).catch(console.error);
    } catch (error) {
      const errorMessage = String(error);
      const historyEntry: QueryHistoryEntry = {
        id: crypto.randomUUID(),
        sql,
        connectionId,
        connectionName: connection.name,
        timestamp: startTime,
        rowCount: null,
        executionTimeMs: null,
        error: errorMessage,
      };

      const newHistory = [historyEntry, ...get().queryHistory].slice(0, 50);
      set({
        queryError: errorMessage,
        isExecuting: false,
        queryResults: null,
        queryHistory: newHistory,
        querySql: null,
      });
      // Persist history to disk
      invoke("save_query_history", { projectRoot: requireProjectRoot(), entries: newHistory }).catch(console.error);
    }
  },

  getParameterDefaults: (connectionId: string, sql: string, mode: SqlPlaceholderMode, spec: SqlPlaceholderSpec) => {
    const key = buildParamCacheKey(connectionId, sql, mode);
    return getParamDefaults(get().parameterDefaults, key, spec);
  },

  saveParameterDefaults: (connectionId: string, sql: string, mode: SqlPlaceholderMode, values: SqlParamDefaults) => {
    const key = buildParamCacheKey(connectionId, sql, mode);
    set((state) => ({
      parameterDefaults: setParamDefaults(state.parameterDefaults, key, values),
    }));
  },

  requestSqlParameters: async (connectionId: string, sql: string, spec: SqlPlaceholderSpec) => {
    const defaults = get().getParameterDefaults(connectionId, sql, spec.mode, spec);
    return new Promise<SqlParamDefaults | null>((resolve) => {
      set({
        pendingSqlParameterPrompt: {
          connectionId,
          sql,
          spec,
          values: defaults,
          resolve,
        },
      });
    });
  },

  submitSqlParameterPrompt: (values: SqlParamDefaults) => {
    const pending = get().pendingSqlParameterPrompt;
    if (!pending) return;
    pending.resolve(values);
    set({ pendingSqlParameterPrompt: null });
  },

  cancelSqlParameterPrompt: () => {
    const pending = get().pendingSqlParameterPrompt;
    if (!pending) return;
    pending.resolve(null);
    set({ pendingSqlParameterPrompt: null });
  },

  resolveSqlWithParameters: async (connectionId: string, sql: string) => {
    const analyzed = analyzeSqlPlaceholders(sql);
    if (analyzed.error) {
      set({ queryError: analyzed.error });
      get().showToast("error", analyzed.error);
      return null;
    }

    if (!analyzed.spec) {
      return sql;
    }

    const submittedValues = await get().requestSqlParameters(connectionId, sql, analyzed.spec);
    if (!submittedValues) {
      return null;
    }

    get().saveParameterDefaults(connectionId, sql, analyzed.spec.mode, submittedValues);

    try {
      return applySqlParams(sql, analyzed.spec, submittedValues);
    } catch (error) {
      const message = `Failed to apply SQL parameters: ${error}`;
      set({ queryError: message });
      get().showToast("error", message);
      return null;
    }
  },

  clearResults: () => {
    set({ queryResults: null, queryError: null, querySql: null, lastQueryContext: null });
  },

  loadQueryHistory: async () => {
    const projectRoot = get().activeProject?.rootPath;
    if (!projectRoot) {
      set({ queryHistory: [] });
      return;
    }
    try {
      const entries = await invoke<QueryHistoryEntry[]>("load_query_history", { projectRoot });
      set({ queryHistory: entries });
    } catch (error) {
      console.error("Failed to load query history:", error);
    }
  },

  clearQueryHistory: async () => {
    const projectRoot = get().activeProject?.rootPath;
    set({ queryHistory: [] });
    if (!projectRoot) return;
    try {
      await invoke("clear_query_history", { projectRoot });
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
