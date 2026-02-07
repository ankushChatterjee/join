import { useState, useMemo } from "react";
import { Clock, Rows3, AlertCircle, Download, X, Tag, Braces, Loader2, Table2 } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { DataTable } from "./DataTable";
import { createColumnsFromData } from "./columnUtils";
import type { TypeDetailInfo, FunctionDetailInfo } from "@/stores/types";

// Type details view component
function TypeDetailsView({ details, onClose }: { details: TypeDetailInfo; onClose: () => void }) {
  // Get badge color based on type kind
  const getTypeKindColor = () => {
    switch (details.type_kind) {
      case "enum":
        return "bg-purple-500/20 text-purple-400";
      case "composite":
        return "bg-orange-500/20 text-orange-400";
      case "domain":
        return "bg-blue-500/20 text-blue-400";
      case "set":
        return "bg-pink-500/20 text-pink-400";
      default:
        return "bg-base-600/20 text-base-400";
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="h-9 flex items-center gap-2 px-3 border-b border-border-subtle shrink-0">
        <Tag className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-base-200">{details.name}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${getTypeKindColor()}`}>
          {details.type_kind}
        </span>
        {details.schema && (
          <span className="text-xs text-base-400">
            in {details.schema}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-base-800/50 text-base-400 hover:text-base-200 transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {details.type_kind === "enum" || details.type_kind === "set" ? (
          <div>
            <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-3">
              {details.type_kind === "enum" ? "Enum Values" : "Set Values"}
            </h3>
            <div className="border border-base-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-base-850">
                    <th className="w-16 px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">#</th>
                    <th className="px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {details.values?.map((value, index) => (
                    <tr key={index} className="hover:bg-base-800/30 transition-colors">
                      <td className="px-4 py-2 text-base-400 font-mono text-xs border-b border-base-800/50">{index + 1}</td>
                      <td className="px-4 py-2 text-base-200 font-mono border-b border-base-800/50">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs text-base-400">
              {details.values?.length || 0} value{(details.values?.length || 0) !== 1 ? 's' : ''}
            </div>
          </div>
        ) : details.type_kind === "composite" ? (
          <div>
            <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-3">
              Composite Type Fields
            </h3>
            <div className="border border-base-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-base-850">
                    <th className="px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">Field</th>
                    <th className="px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {details.fields?.map((field, index) => (
                    <tr key={index} className="hover:bg-base-800/30 transition-colors">
                      <td className="px-4 py-2 text-base-200 font-mono border-b border-base-800/50">{field.name}</td>
                      <td className="px-4 py-2 text-accent-400 font-mono text-xs border-b border-base-800/50">{field.data_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs text-base-400">
              {details.fields?.length || 0} field{(details.fields?.length || 0) !== 1 ? 's' : ''}
            </div>
          </div>
        ) : details.type_kind === "domain" ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-2">
                Base Type
              </h3>
              <div className="bg-base-850 border border-base-700 rounded-lg px-4 py-3">
                <span className="font-mono text-accent-400">{details.base_type || "unknown"}</span>
              </div>
            </div>
            {details.constraint && (
              <div>
                <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-2">
                  Constraint
                </h3>
                <div className="bg-base-850 border border-base-700 rounded-lg px-4 py-3">
                  <code className="font-mono text-sm text-base-200">{details.constraint}</code>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-base-400">Unknown type kind: {details.type_kind}</div>
        )}
      </div>
    </div>
  );
}

// Function details view component
function FunctionDetailsView({ details, onClose }: { details: FunctionDetailInfo; onClose: () => void }) {
  // Get badge color based on function characteristics
  const getVolatilityColor = () => {
    switch (details.volatility) {
      case "IMMUTABLE":
        return "bg-green-500/20 text-green-400";
      case "STABLE":
        return "bg-blue-500/20 text-blue-400";
      case "VOLATILE":
        return "bg-orange-500/20 text-orange-400";
      default:
        return "bg-base-600/20 text-base-400";
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="h-9 flex items-center gap-2 px-3 border-b border-border-subtle shrink-0">
        <Braces className="w-4 h-4 text-teal-400" />
        <span className="text-sm font-medium text-base-200">{details.name}</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase bg-teal-500/20 text-teal-400">
          {details.is_aggregate ? "aggregate" : "function"}
        </span>
        {details.schema && (
          <span className="text-xs text-base-400">
            in {details.schema}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-base-800/50 text-base-400 hover:text-base-200 transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Description if available */}
        {details.description && (
          <div>
            <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-2">
              Description
            </h3>
            <div className="bg-base-850 border border-base-700 rounded-lg px-4 py-3">
              <p className="text-sm text-base-200">{details.description}</p>
            </div>
          </div>
        )}

        {/* Signature */}
        <div>
          <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-2">
            Signature
          </h3>
          <div className="bg-base-850 border border-base-700 rounded-lg px-4 py-3">
            <code className="font-mono text-sm text-base-200">
              <span className="text-teal-400">{details.name}</span>
              <span className="text-base-400">(</span>
              {details.arguments.length > 0 ? (
                details.arguments.map((arg, index) => (
                  <span key={index}>
                    {index > 0 && <span className="text-base-400">, </span>}
                    {arg.mode !== "IN" && (
                      <span className="text-purple-400">{arg.mode} </span>
                    )}
                    {arg.name && <span className="text-base-200">{arg.name} </span>}
                    <span className="text-accent-400">{arg.data_type}</span>
                    {arg.has_default && (
                      <span className="text-base-500"> = ...</span>
                    )}
                  </span>
                ))
              ) : (
                <span className="text-base-500 italic">no arguments</span>
              )}
              <span className="text-base-400">)</span>
              <span className="text-base-400"> → </span>
              <span className="text-accent-400">{details.return_type || "void"}</span>
            </code>
          </div>
        </div>

        {/* Arguments table (if any) */}
        {details.arguments.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-3">
              Arguments
            </h3>
            <div className="border border-base-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-base-850">
                    <th className="px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">Name</th>
                    <th className="px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">Mode</th>
                    <th className="px-4 py-2 text-left font-medium text-base-300 border-b border-base-700">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {details.arguments.map((arg, index) => (
                    <tr key={index} className="hover:bg-base-800/30 transition-colors">
                      <td className="px-4 py-2 text-base-200 font-mono border-b border-base-800/50">
                        {arg.name || <span className="text-base-500 italic">unnamed</span>}
                      </td>
                      <td className="px-4 py-2 text-accent-400 font-mono text-xs border-b border-base-800/50">{arg.data_type}</td>
                      <td className="px-4 py-2 border-b border-base-800/50">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                          arg.mode === "OUT" ? "bg-purple-500/20 text-purple-400" :
                          arg.mode === "INOUT" ? "bg-orange-500/20 text-orange-400" :
                          arg.mode === "VARIADIC" ? "bg-pink-500/20 text-pink-400" :
                          "bg-base-600/20 text-base-400"
                        }`}>
                          {arg.mode}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-base-400 border-b border-base-800/50">
                        {arg.has_default ? "Yes" : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Metadata badges */}
        <div className="flex flex-wrap gap-2">
          {details.language && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-base-700/50 text-base-300">
              Language: {details.language}
            </span>
          )}
          {details.volatility && (
            <span className={`px-2 py-1 rounded text-xs font-medium ${getVolatilityColor()}`}>
              {details.volatility}
            </span>
          )}
          {details.is_aggregate && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-teal-500/20 text-teal-400">
              Aggregate
            </span>
          )}
        </div>

        {/* Definition */}
        {details.definition && (
          <div>
            <h3 className="text-xs font-medium text-base-300 uppercase tracking-wide mb-2">
              Definition
            </h3>
            <div className="bg-base-850 border border-base-700 rounded-lg overflow-hidden">
              <pre className="p-4 text-sm text-base-200 font-mono overflow-x-auto whitespace-pre-wrap">
                {details.definition}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultsPanel() {
  const [isExporting, setIsExporting] = useState(false);
  const { 
    queryResults, 
    queryError, 
    isExecuting, 
    showToast, 
    activeConnectionId, 
    connections,
    selectedSchemaObject,
    schemaObjectDetails,
    isLoadingSchemaObjectDetails,
    clearSchemaObjectSelection,
    previewSource,
  } = useAppStore();
  
  // Get the active connection's database type
  const activeConnection = connections.find(c => c.id === activeConnectionId);
  const dbType = activeConnection?.db_type;

  const handleExport = async () => {
    if (!queryResults || isExporting) return;

    try {
      setIsExporting(true);
      const filePath = await save({
        filters: [{ name: "CSV", extensions: ["csv"] }],
        defaultPath: "export.csv",
      });

      if (filePath) {
        await invoke("export_to_csv", {
          filePath,
          data: {
            columns: queryResults.columns.map((c) => c.name),
            rows: queryResults.rows,
          },
        });
        showToast("success", "Exported successfully");
      }
    } catch (err) {
      showToast("error", `Export failed: ${err}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Convert query results to table format (memoized for performance)
  const tableData = useMemo(() => {
    if (!queryResults) return [];
    return queryResults.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      queryResults.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
  }, [queryResults]);

  const columns = useMemo(
    () => createColumnsFromData(tableData, queryResults?.columns, dbType),
    [tableData, queryResults?.columns, dbType]
  );

  // Show loading state for schema object details
  if (selectedSchemaObject && isLoadingSchemaObjectDetails) {
    return (
      <div className="h-full flex flex-col bg-surface">
        <div className="h-9 border-b border-border-subtle shrink-0 flex items-center px-3">
          <span className="text-sm text-base-300">Loading details...</span>
          <div className="flex-1" />
          <button
            onClick={clearSchemaObjectSelection}
            className="p-1 rounded hover:bg-base-800/50 text-base-400 hover:text-base-200 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-base-400">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent-500" />
            Loading...
          </div>
        </div>
      </div>
    );
  }

  // Show schema object details if selected
  if (selectedSchemaObject) {
    if (selectedSchemaObject.type === "custom_type" && schemaObjectDetails) {
      return (
        <TypeDetailsView 
          details={schemaObjectDetails as TypeDetailInfo} 
          onClose={clearSchemaObjectSelection} 
        />
      );
    }
    if (selectedSchemaObject.type === "function" && schemaObjectDetails) {
      return (
        <FunctionDetailsView 
          details={schemaObjectDetails as FunctionDetailInfo} 
          onClose={clearSchemaObjectSelection} 
        />
      );
    }
  }

  // Show loading state
  if (isExecuting) {
    return (
      <div className="h-full flex flex-col bg-surface">
        <div className="h-9 border-b border-border-subtle shrink-0" />
        <div className="flex-1 flex items-center justify-center text-base-400">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            Executing query...
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (queryError) {
    const isConnectionError = queryError.startsWith("Connection failed:");
    return (
      <div className="h-full flex flex-col bg-surface">
        <div className="h-9 border-b border-border-subtle shrink-0" />
        <div className="flex-1 p-4">
          <div className="flex items-start gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="font-mono text-sm">
              <div className="font-medium">{isConnectionError ? "Connection failed" : "Query failed"}</div>
              <div className="mt-1 text-red-400/80 whitespace-pre-wrap">
                {isConnectionError ? queryError.replace("Connection failed: ", "") : queryError}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show results or empty state
  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header bar */}
      <div className="h-9 flex items-center gap-1 px-3 border-b border-border-subtle shrink-0">
        {queryResults ? (
          <>
            {/* Preview source / table name */}
            {previewSource && (
              <div className="flex items-center gap-1.5 text-xs text-base-200 mr-3">
                <Table2 className="w-3.5 h-3.5 text-accent-500" />
                <span className="font-medium">{previewSource}</span>
              </div>
            )}
            
            {/* Stats */}
            <div className="flex items-center gap-4 text-xs text-base-400">
              <div className="flex items-center gap-1.5">
                <Rows3 className="w-3.5 h-3.5" />
                <span>
                  <span className="text-base-200">{queryResults.row_count}</span> rows
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  <span className="text-base-200">{queryResults.execution_time_ms}</span>ms
                </span>
              </div>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Export button */}
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-base-800/50 text-base-400 hover:text-base-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              title="Export to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </>
        ) : (
          <div className="text-xs text-base-400">Results</div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {queryResults ? (
          <DataTable data={tableData} columns={columns} />
        ) : (
          <div className="h-full flex items-center justify-center text-base-400 text-sm">
            Run a query to see results
          </div>
        )}
      </div>
    </div>
  );
}
