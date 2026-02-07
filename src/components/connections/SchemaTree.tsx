import { useRef, useEffect, useState } from "react";
import {
  ChevronRight,
  Database,
  FolderClosed,
  FolderOpen,
  Table2,
  Key,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  Loader2,
  Eye,
  ListTree,
  Fingerprint,
  Braces,
  FileCode,
  Plus,
  Trash2,
  Pencil,
  FunctionSquare,
  Shapes,
  Tag,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { insertTextAtCursor, generateSelectStatement } from "@/components/editor/editorUtils";
import type { ColumnInfo, TableInfo, ViewInfo, IndexInfo, FunctionInfo, CustomTypeInfo, ScriptMetadata } from "@/stores/types";

const typeIcons: Record<string, typeof Hash> = {
  uuid: Key,
  serial: Hash,
  integer: Hash,
  int: Hash,
  bigint: Hash,
  smallint: Hash,
  varchar: Type,
  text: Type,
  char: Type,
  decimal: Hash,
  numeric: Hash,
  float: Hash,
  double: Hash,
  real: Hash,
  timestamp: Calendar,
  datetime: Calendar,
  date: Calendar,
  time: Calendar,
  boolean: ToggleLeft,
  bool: ToggleLeft,
};

function getTypeIcon(dataType: string) {
  const baseType = dataType.split("(")[0].toLowerCase();
  return typeIcons[baseType] || Type;
}

interface TreeNodeProps {
  level: number;
  children: React.ReactNode;
}

function TreeNode({ level, children }: TreeNodeProps) {
  return (
    <div style={{ paddingLeft: `${level * 12}px` }}>
      {children}
    </div>
  );
}

interface ColumnNodeProps {
  column: ColumnInfo;
  level: number;
}

function ColumnNode({ column, level }: ColumnNodeProps) {
  const Icon = column.is_primary_key ? Key : getTypeIcon(column.data_type);
  
  return (
    <TreeNode level={level}>
      <div className="flex items-center gap-2 py-1 px-2 text-sm hover:bg-base-800/30 rounded transition-colors">
        <Icon 
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            column.is_primary_key ? "text-warning" : "text-base-500"
          )} 
        />
        <span className={cn(
          "truncate min-w-0",
          column.is_primary_key ? "text-base-100" : "text-base-300"
        )}>
          {column.name}
        </span>
        <span 
          className="ml-auto text-xs text-base-500 font-mono shrink-0 truncate max-w-[12ch]"
          title={column.data_type}
        >
          {column.data_type}
        </span>
      </div>
    </TreeNode>
  );
}

interface IndexNodeProps {
  index: IndexInfo;
  level: number;
}

function IndexNode({ index, level }: IndexNodeProps) {
  return (
    <TreeNode level={level}>
      <div className="flex items-center gap-2 py-1 px-2 text-sm hover:bg-base-800/30 rounded transition-colors">
        <Fingerprint 
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            index.is_primary ? "text-warning" : index.is_unique ? "text-cyan-500" : "text-base-500"
          )} 
        />
        <span className={cn(
          "truncate",
          index.is_primary ? "text-base-100" : "text-base-300"
        )}>
          {index.name}
        </span>
        {(index.is_primary || index.is_unique) && (
          <span className="ml-auto text-xs text-base-500 font-mono shrink-0">
            {index.is_primary ? "PK" : "UNIQUE"}
          </span>
        )}
      </div>
    </TreeNode>
  );
}

interface IndexFolderNodeProps {
  tableOrViewName: string;
  schema: string;
  level: number;
}

function IndexFolderNode({ tableOrViewName, schema, level }: IndexFolderNodeProps) {
  const { expandedIndexFolders, indexes, toggleIndexFolderExpanded } = useAppStore();
  
  const key = `${schema}.${tableOrViewName}`;
  const isExpanded = expandedIndexFolders.has(key);
  const tableIndexes = indexes[key];
  const isLoading = isExpanded && !tableIndexes;
  
  return (
    <div>
      <TreeNode level={level}>
        <button
          onClick={() => toggleIndexFolderExpanded(schema, tableOrViewName)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isExpanded && "rotate-90"
            )}
          />
          <ListTree className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="text-base-300 group-hover:text-base-100 truncate text-left">
            Indexes
          </span>
          {isLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-base-500 ml-auto shrink-0" />
          )}
        </button>
      </TreeNode>
      
      {isExpanded && tableIndexes && (
        <div className="border-l border-base-800 ml-4">
          {tableIndexes.length > 0 ? (
            tableIndexes.map((index) => (
              <IndexNode
                key={index.name}
                index={index}
                level={level + 1}
              />
            ))
          ) : (
            <TreeNode level={level + 1}>
              <div className="py-1 px-2 text-sm text-base-400">
                No indexes
              </div>
            </TreeNode>
          )}
        </div>
      )}
    </div>
  );
}

interface TableNodeProps {
  table: TableInfo;
  schema: string;
  level: number;
}

function TableNode({ table, schema, level }: TableNodeProps) {
  const { 
    expandedTables, 
    columns, 
    indexes, 
    toggleTableExpanded, 
    activeConnectionId,
    executeQueryDirect,
  } = useAppStore();
  
  const key = `${schema}.${table.name}`;
  const isExpanded = expandedTables.has(key);
  const tableColumns = columns[key];
  const tableIndexes = indexes[key];
  const isLoading = isExpanded && !tableColumns;
  const hasIndexes = tableIndexes && tableIndexes.length > 0;

  // Handle preview table
  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeConnectionId) return;
    const sql = `SELECT * FROM ${schema}.${table.name} LIMIT 100`;
    executeQueryDirect(activeConnectionId, sql, `${schema}.${table.name}`);
  };

  // Handle generate SELECT
  const handleGenerateSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    const columnNames = tableColumns?.map(c => c.name);
    const sql = generateSelectStatement(schema, table.name, columnNames);
    insertTextAtCursor(sql);
  };
  
  return (
    <div>
      <TreeNode level={level}>
        <button
          onClick={() => toggleTableExpanded(schema, table.name)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isExpanded && "rotate-90"
            )}
          />
          <Table2 className="w-4 h-4 text-accent-500 shrink-0" />
          <span className="text-base-200 group-hover:text-base-50 truncate text-left flex-1">
            {table.name}
          </span>
          {isLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-base-500 shrink-0" />
          )}
          {/* Action buttons - visible on hover */}
          <span
            role="button"
            tabIndex={-1}
            onClick={handlePreview}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-600/50 text-base-400 hover:text-green-400 transition-opacity shrink-0"
            title="Preview first 100 rows"
          >
            <Play className="w-3 h-3" />
          </span>
          <span
            role="button"
            tabIndex={-1}
            onClick={handleGenerateSelect}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-600/50 text-base-400 hover:text-accent-400 transition-opacity shrink-0"
            title="Generate SELECT"
          >
            <FileCode className="w-3 h-3" />
          </span>
        </button>
      </TreeNode>
      
      {isExpanded && tableColumns && (
        <div className="border-l border-base-800 ml-4">
          {hasIndexes && (
            <IndexFolderNode
              tableOrViewName={table.name}
              schema={schema}
              level={level + 1}
            />
          )}
          {tableColumns.map((column) => (
            <ColumnNode
              key={column.name}
              column={column}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ViewNodeProps {
  view: ViewInfo;
  schema: string;
  level: number;
}

function ViewNode({ view, schema, level }: ViewNodeProps) {
  const { 
    expandedViews, 
    columns, 
    indexes, 
    toggleViewExpanded,
    activeConnectionId,
    executeQueryDirect,
  } = useAppStore();
  
  const key = `${schema}.${view.name}`;
  const isExpanded = expandedViews.has(key);
  const viewColumns = columns[key];
  const viewIndexes = indexes[key];
  const isLoading = isExpanded && !viewColumns;
  const hasIndexes = viewIndexes && viewIndexes.length > 0;

  // Handle preview view
  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeConnectionId) return;
    const sql = `SELECT * FROM ${schema}.${view.name} LIMIT 100`;
    executeQueryDirect(activeConnectionId, sql, `${schema}.${view.name}`);
  };

  // Handle generate SELECT
  const handleGenerateSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    const columnNames = viewColumns?.map(c => c.name);
    const sql = generateSelectStatement(schema, view.name, columnNames);
    insertTextAtCursor(sql);
  };
  
  return (
    <div>
      <TreeNode level={level}>
        <button
          onClick={() => toggleViewExpanded(schema, view.name)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isExpanded && "rotate-90"
            )}
          />
          <Eye className="w-4 h-4 text-violet-400 shrink-0" />
          <span className="text-base-200 group-hover:text-base-50 truncate text-left flex-1">
            {view.name}
          </span>
          {isLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-base-500 shrink-0" />
          )}
          {/* Action buttons - visible on hover */}
          <span
            role="button"
            tabIndex={-1}
            onClick={handlePreview}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-600/50 text-base-400 hover:text-green-400 transition-opacity shrink-0"
            title="Preview first 100 rows"
          >
            <Play className="w-3 h-3" />
          </span>
          <span
            role="button"
            tabIndex={-1}
            onClick={handleGenerateSelect}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-600/50 text-base-400 hover:text-accent-400 transition-opacity shrink-0"
            title="Generate SELECT"
          >
            <FileCode className="w-3 h-3" />
          </span>
        </button>
      </TreeNode>
      
      {isExpanded && viewColumns && (
        <div className="border-l border-base-800 ml-4">
          {hasIndexes && (
            <IndexFolderNode
              tableOrViewName={view.name}
              schema={schema}
              level={level + 1}
            />
          )}
          {viewColumns.map((column) => (
            <ColumnNode
              key={column.name}
              column={column}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FunctionNodeProps {
  func: FunctionInfo;
  schema: string;
  level: number;
}

function FunctionNode({ func, schema, level }: FunctionNodeProps) {
  const { selectSchemaObject, selectedSchemaObject } = useAppStore();
  const isSelected = selectedSchemaObject?.type === "function" && 
                     selectedSchemaObject?.specificName === func.specific_name && 
                     selectedSchemaObject?.schema === schema;
  
  return (
    <TreeNode level={level}>
      <button
        onClick={() => selectSchemaObject("function", func.name, schema, func.specific_name)}
        className={cn(
          "w-full flex items-center gap-2 py-1 px-2 text-sm rounded transition-colors cursor-pointer",
          isSelected
            ? "bg-accent-500/20 text-accent-300"
            : "hover:bg-base-800/30"
        )}
      >
        <Braces className={cn(
          "w-4 h-4 shrink-0",
          isSelected ? "text-accent-400" : "text-teal-400"
        )} />
        <span className={cn(
          "truncate text-left",
          isSelected ? "text-accent-300" : "text-base-200"
        )}>
          {func.name}
        </span>
        {func.return_type && (
          <span className="ml-auto text-xs text-base-500 font-mono shrink-0">
            {func.return_type}
          </span>
        )}
      </button>
    </TreeNode>
  );
}

interface FunctionsFolderNodeProps {
  schemaName: string;
  functions: FunctionInfo[];
  level: number;
}

function FunctionsFolderNode({ schemaName, functions, level }: FunctionsFolderNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (functions.length === 0) return null;
  
  return (
    <div>
      <TreeNode level={level}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isExpanded && "rotate-90"
            )}
          />
          <FunctionSquare className="w-4 h-4 text-teal-500 shrink-0" />
          <span className="text-base-300 group-hover:text-base-100 truncate text-left">
            Functions
          </span>
        </button>
      </TreeNode>
      
      {isExpanded && (
        <div className="border-l border-base-800 ml-4">
          {functions.map((func) => (
            <FunctionNode
              key={`func-${func.specific_name}`}
              func={func}
              schema={schemaName}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TypeNodeProps {
  customType: CustomTypeInfo;
  schema: string;
  level: number;
}

function TypeNode({ customType, schema, level }: TypeNodeProps) {
  const { selectSchemaObject, selectedSchemaObject } = useAppStore();
  const isSelected = selectedSchemaObject?.type === "custom_type" && 
                     selectedSchemaObject?.name === customType.name && 
                     selectedSchemaObject?.schema === schema;
  
  // Color coding by type kind
  const getTypeColor = () => {
    switch (customType.type_kind) {
      case "enum":
        return isSelected ? "text-accent-400" : "text-purple-400";
      case "composite":
        return isSelected ? "text-accent-400" : "text-orange-400";
      case "domain":
        return isSelected ? "text-accent-400" : "text-blue-400";
      case "set":
        return isSelected ? "text-accent-400" : "text-pink-400";
      default:
        return isSelected ? "text-accent-400" : "text-base-400";
    }
  };
  
  return (
    <TreeNode level={level}>
      <button
        onClick={() => selectSchemaObject("custom_type", customType.name, schema)}
        className={cn(
          "w-full flex items-center gap-2 py-1 px-2 text-sm rounded transition-colors cursor-pointer",
          isSelected
            ? "bg-accent-500/20 text-accent-300"
            : "hover:bg-base-800/30"
        )}
      >
        <Tag className={cn("w-4 h-4 shrink-0", getTypeColor())} />
        <span className={cn(
          "truncate text-left",
          isSelected ? "text-accent-300" : "text-base-200"
        )}>
          {customType.name}
        </span>
        <span className="ml-auto text-xs text-base-500 font-mono shrink-0">
          {customType.type_kind}
        </span>
      </button>
    </TreeNode>
  );
}

interface TypesFolderNodeProps {
  schemaName: string;
  types: CustomTypeInfo[];
  level: number;
}

function TypesFolderNode({ schemaName, types, level }: TypesFolderNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (types.length === 0) return null;
  
  return (
    <div>
      <TreeNode level={level}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isExpanded && "rotate-90"
            )}
          />
          <Shapes className="w-4 h-4 text-purple-500 shrink-0" />
          <span className="text-base-300 group-hover:text-base-100 truncate text-left">
            Types
          </span>
        </button>
      </TreeNode>
      
      {isExpanded && (
        <div className="border-l border-base-800 ml-4">
          {types.map((t) => (
            <TypeNode
              key={`type-${t.name}`}
              customType={t}
              schema={schemaName}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ScriptNodeProps {
  script: ScriptMetadata;
  connectionId: string;
  level: number;
}

function ScriptNode({ script, connectionId, level }: ScriptNodeProps) {
  const { openScript, deleteScript, renameScript, activeScriptId } = useAppStore();
  const isActive = activeScriptId === script.id;
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(script.name);
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
  
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete script "${script.name}"?`)) {
      await deleteScript(connectionId, script.id);
    }
  };
  
  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(script.name);
    setIsEditing(true);
  };
  
  const handleSaveEdit = async () => {
    const trimmedName = editName.trim();
    if (trimmedName && trimmedName !== script.name) {
      await renameScript(script.id, trimmedName);
    }
    setIsEditing(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      setEditName(script.name);
      setIsEditing(false);
    }
  };
  
  if (isEditing) {
    return (
      <TreeNode level={level}>
        <div className="flex items-center gap-2 py-0.5 px-2">
          <FileCode className="w-4 h-4 shrink-0 text-sky-400" />
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-base-800 border border-accent-500 rounded px-1.5 py-0.5 text-sm text-base-100 outline-none"
          />
        </div>
      </TreeNode>
    );
  }
  
  return (
    <TreeNode level={level}>
      <button
        onClick={() => openScript(connectionId, script.id)}
        onDoubleClick={handleStartEdit}
        className={cn(
          "w-full flex items-center gap-2 py-1 px-2 text-sm rounded transition-colors cursor-pointer group",
          isActive
            ? "bg-accent-500/20 text-accent-300"
            : "hover:bg-base-800/30 text-base-300"
        )}
      >
        <FileCode className={cn(
          "w-4 h-4 shrink-0",
          isActive ? "text-accent-400" : "text-sky-400"
        )} />
        <span className="truncate text-left flex-1">
          {script.name}
        </span>
        <span
          role="button"
          tabIndex={-1}
          onClick={handleStartEdit}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-600/50 text-base-400 hover:text-base-200 transition-opacity"
          title="Rename"
        >
          <Pencil className="w-3 h-3" />
        </span>
        <span
          role="button"
          tabIndex={-1}
          onClick={handleDelete}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-600/50 text-base-400 hover:text-red-400 transition-opacity"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </span>
      </button>
    </TreeNode>
  );
}

interface ScriptsFolderNodeProps {
  connectionId: string;
  level: number;
}

function ScriptsFolderNode({ connectionId, level }: ScriptsFolderNodeProps) {
  const { 
    isScriptsFolderExpanded, 
    toggleScriptsFolderExpanded,
    scriptsByConnection,
    createScript,
  } = useAppStore();
  
  const scripts = scriptsByConnection[connectionId] || [];
  const FolderIcon = isScriptsFolderExpanded ? FolderOpen : FolderClosed;
  
  const handleNewScript = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await createScript(connectionId);
  };
  
  return (
    <div>
      <TreeNode level={level}>
        <button
          onClick={toggleScriptsFolderExpanded}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isScriptsFolderExpanded && "rotate-90"
            )}
          />
          <FolderIcon className="w-4 h-4 text-sky-500 shrink-0" />
          <span className="text-base-200 group-hover:text-base-50 truncate text-left flex-1">
            Scripts
          </span>
          <span
            role="button"
            tabIndex={-1}
            onClick={handleNewScript}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-600/50 text-base-400 hover:text-base-100 transition-opacity ml-1"
            title="New script"
          >
            <Plus className="w-3.5 h-3.5" />
          </span>
        </button>
      </TreeNode>
      
      {isScriptsFolderExpanded && (
        <div className="border-l border-base-800 ml-4">
          {scripts.length > 0 ? (
            scripts.map((script) => (
              <ScriptNode
                key={script.id}
                script={script}
                connectionId={connectionId}
                level={level + 1}
              />
            ))
          ) : (
            <TreeNode level={level + 1}>
              <button
                onClick={handleNewScript}
                className="py-1 px-2 text-sm text-base-400 hover:text-accent-400 cursor-pointer"
              >
                + New script
              </button>
            </TreeNode>
          )}
        </div>
      )}
    </div>
  );
}

interface SchemaNodeProps {
  schemaName: string;
  level: number;
}

function SchemaNode({ schemaName, level }: SchemaNodeProps) {
  const { 
    expandedSchemas, 
    tablesBySchema,
    viewsBySchema,
    functionsBySchema,
    typesBySchema,
    loadingSchemas,
    toggleSchemaExpanded 
  } = useAppStore();
  
  const isExpanded = expandedSchemas.has(schemaName);
  const tables = tablesBySchema[schemaName];
  const views = viewsBySchema[schemaName];
  const functions = functionsBySchema[schemaName];
  const types = typesBySchema[schemaName];
  const isLoading = loadingSchemas.has(schemaName);
  
  const FolderIcon = isExpanded ? FolderOpen : FolderClosed;

  const isEmpty = (!tables || tables.length === 0) && 
                  (!views || views.length === 0) && 
                  (!functions || functions.length === 0) &&
                  (!types || types.length === 0);
  
  return (
    <div>
      <TreeNode level={level}>
        <button
          onClick={() => toggleSchemaExpanded(schemaName)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isExpanded && "rotate-90"
            )}
          />
          <FolderIcon className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-base-200 group-hover:text-base-50 truncate text-left">
            {schemaName}
          </span>
          {isLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-base-500 ml-auto shrink-0" />
          )}
        </button>
      </TreeNode>
      
      {isExpanded && (
        <div className="border-l border-base-800 ml-4">
          {isLoading ? (
            <TreeNode level={level + 1}>
              <div className="py-2 px-2 text-sm text-base-400 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading...
              </div>
            </TreeNode>
          ) : (
            <>
              {/* Tables */}
              {tables && tables.length > 0 && (
                tables.map((table) => (
                  <TableNode
                    key={`table-${table.name}`}
                    table={table}
                    schema={schemaName}
                    level={level + 1}
                  />
                ))
              )}
              {/* Views */}
              {views && views.length > 0 && (
                views.map((view) => (
                  <ViewNode
                    key={`view-${view.name}`}
                    view={view}
                    schema={schemaName}
                    level={level + 1}
                  />
                ))
              )}
              {/* Functions folder */}
              {functions && functions.length > 0 && (
                <FunctionsFolderNode
                  schemaName={schemaName}
                  functions={functions}
                  level={level + 1}
                />
              )}
              {/* Types folder */}
              {types && types.length > 0 && (
                <TypesFolderNode
                  schemaName={schemaName}
                  types={types}
                  level={level + 1}
                />
              )}
              {/* Empty state */}
              {isEmpty && (
                <TreeNode level={level + 1}>
                  <div className="py-2 px-2 text-sm text-base-400">
                    No tables, views, functions, or types
                  </div>
                </TreeNode>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function SchemaTree() {
  const {
    activeConnectionId,
    connections,
    schemas,
    isLoadingSchema,
    isDbExpanded,
    toggleDbExpanded,
  } = useAppStore();

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  if (!activeConnectionId || !activeConnection) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-base-400 px-4 text-center">
        Connect to a database to see schema
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto py-1 sidebar-scroll">
      {/* Scripts folder - shown at top level */}
      <ScriptsFolderNode connectionId={activeConnectionId} level={0} />

      {/* Database root node */}
      <TreeNode level={0}>
        <button
          onClick={toggleDbExpanded}
          className="w-full flex items-center gap-1.5 py-1.5 px-2 text-sm hover:bg-base-800/50 rounded transition-colors cursor-pointer group"
        >
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-base-500 transition-transform duration-150 shrink-0",
              isDbExpanded && "rotate-90"
            )}
          />
          <Database className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="font-medium text-base-100 group-hover:text-base-50 truncate text-left">
            {activeConnection.database}
          </span>
          {isLoadingSchema && (
            <Loader2 className="w-3 h-3 animate-spin text-base-500 ml-auto shrink-0" />
          )}
        </button>
      </TreeNode>

      {isDbExpanded && (
        <div className="border-l border-base-800 ml-3">
          {isLoadingSchema && schemas.length === 0 ? (
            <TreeNode level={1}>
              <div className="py-2 px-2 text-sm text-base-400 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading schemas...
              </div>
            </TreeNode>
          ) : schemas.length > 0 ? (
            schemas.map((schema) => (
              <SchemaNode
                key={schema.name}
                schemaName={schema.name}
                level={1}
              />
            ))
          ) : (
            <TreeNode level={1}>
              <div className="py-2 px-2 text-sm text-base-400">
                No schemas found
              </div>
            </TreeNode>
          )}
        </div>
      )}
    </div>
  );
}
