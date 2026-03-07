import { useState } from "react";
import { AlertCircle, Download, X, Tag, Braces, Loader2, Save, Expand, ChevronsDown, MessageSquare } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { useAiStore } from "@/stores/aiStore";
import type { TypeDetailInfo, FunctionDetailInfo } from "@/stores/types";
import { useShallow } from "zustand/react/shallow";
import { ResultsView } from "./ResultsView";

// Type details view component
function TypeDetailsView({ details, onClose }: { details: TypeDetailInfo; onClose: () => void }) {
  // Get badge color based on type kind
  const getTypeKindColor = () => {
    switch (details.type_kind) {
      case "enum":
        return "bg-base-700/60 text-base-200";
      case "composite":
        return "bg-base-700/60 text-base-200";
      case "domain":
        return "bg-base-700/60 text-base-200";
      case "set":
        return "bg-base-700/60 text-base-200";
      default:
        return "bg-base-600/20 text-base-400";
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="h-8 flex items-center gap-1.5 px-2.5 border-b border-base-750 shrink-0">
        <Tag className="w-4 h-4 text-accent-400" />
        <span className="text-xs font-semibold text-base-200">{details.name}</span>
        <span className={`px-1.5 py-0.5 rounded-sm text-[11px] font-medium uppercase ${getTypeKindColor()}`}>
          {details.type_kind}
        </span>
        {details.schema && (
          <span className="text-xs text-base-300">
            in {details.schema}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto panel-scroll p-3">
        {details.type_kind === "enum" || details.type_kind === "set" ? (
          <div>
            <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-2">
              {details.type_kind === "enum" ? "Enum Values" : "Set Values"}
            </h3>
            <div className="border border-base-700 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-base-850">
                    <th className="w-14 px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">#</th>
                    <th className="px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {details.values?.map((value, index) => (
                    <tr key={index} className="hover:bg-base-800/30 transition-colors">
                      <td className="px-3 py-1.5 text-base-300 font-mono text-[11px] border-b border-base-800/50">{index + 1}</td>
                      <td className="px-3 py-1.5 text-base-200 font-mono text-[11px] border-b border-base-800/50">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-base-300">
              {details.values?.length || 0} value{(details.values?.length || 0) !== 1 ? 's' : ''}
            </div>
          </div>
        ) : details.type_kind === "composite" ? (
          <div>
            <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-2">
              Composite Type Fields
            </h3>
            <div className="border border-base-700 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-base-850">
                    <th className="px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">Field</th>
                    <th className="px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {details.fields?.map((field, index) => (
                    <tr key={index} className="hover:bg-base-800/30 transition-colors">
                      <td className="px-3 py-1.5 text-base-200 font-mono text-[11px] border-b border-base-800/50">{field.name}</td>
                      <td className="px-3 py-1.5 text-accent-400 font-mono text-[11px] border-b border-base-800/50">{field.data_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-base-300">
              {details.fields?.length || 0} field{(details.fields?.length || 0) !== 1 ? 's' : ''}
            </div>
          </div>
        ) : details.type_kind === "domain" ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-1.5">
                Base Type
              </h3>
              <div className="bg-base-850 border border-base-700 rounded-sm px-3 py-2">
                <span className="font-mono text-accent-400">{details.base_type || "unknown"}</span>
              </div>
            </div>
            {details.constraint && (
              <div>
                <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-1.5">
                  Constraint
                </h3>
                <div className="bg-base-850 border border-base-700 rounded-sm px-3 py-2">
                  <code className="font-mono text-sm text-base-200">{details.constraint}</code>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-base-300">Unknown type kind: {details.type_kind}</div>
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
        return "bg-base-700/60 text-base-200";
      case "STABLE":
        return "bg-base-700/60 text-base-200";
      case "VOLATILE":
        return "bg-base-700/60 text-base-200";
      default:
        return "bg-base-600/20 text-base-400";
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="h-8 flex items-center gap-1.5 px-2.5 border-b border-base-750 shrink-0">
        <Braces className="w-4 h-4 text-accent-400" />
        <span className="text-xs font-semibold text-base-200">{details.name}</span>
        <span className="px-1.5 py-0.5 rounded-sm text-[11px] font-medium uppercase bg-base-700/60 text-base-200">
          {details.is_aggregate ? "aggregate" : "function"}
        </span>
        {details.schema && (
          <span className="text-xs text-base-300">
            in {details.schema}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto panel-scroll p-3 space-y-3">
        {/* Description if available */}
        {details.description && (
          <div>
            <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-1.5">
              Description
            </h3>
            <div className="bg-base-850 border border-base-700 rounded-sm px-3 py-2">
              <p className="text-sm text-base-200">{details.description}</p>
            </div>
          </div>
        )}

        {/* Signature */}
        <div>
          <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-1.5">
            Signature
          </h3>
          <div className="bg-base-850 border border-base-700 rounded-sm px-3 py-2">
            <code className="font-mono text-[12px] text-base-200">
              <span className="text-accent-400">{details.name}</span>
              <span className="text-base-300">(</span>
              {details.arguments.length > 0 ? (
                details.arguments.map((arg, index) => (
                  <span key={index}>
                    {index > 0 && <span className="text-base-300">, </span>}
                    {arg.mode !== "IN" && (
                      <span className="text-base-300">{arg.mode} </span>
                    )}
                    {arg.name && <span className="text-base-200">{arg.name} </span>}
                    <span className="text-accent-400">{arg.data_type}</span>
                    {arg.has_default && (
                      <span className="text-base-300"> = ...</span>
                    )}
                  </span>
                ))
              ) : (
                <span className="text-base-300 italic">no arguments</span>
              )}
              <span className="text-base-300">)</span>
              <span className="text-base-300"> → </span>
              <span className="text-accent-400">{details.return_type || "void"}</span>
            </code>
          </div>
        </div>

        {/* Arguments table (if any) */}
        {details.arguments.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-2">
              Arguments
            </h3>
            <div className="border border-base-700 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-base-850">
                    <th className="px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">Name</th>
                    <th className="px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">Type</th>
                    <th className="px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">Mode</th>
                    <th className="px-3 py-1.5 text-left font-medium text-base-300 border-b border-base-700">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {details.arguments.map((arg, index) => (
                    <tr key={index} className="hover:bg-base-800/30 transition-colors">
                      <td className="px-3 py-1.5 text-base-200 text-[11px] font-mono border-b border-base-800/50">
                        {arg.name || <span className="text-base-300 italic">unnamed</span>}
                      </td>
                      <td className="px-3 py-1.5 text-accent-400 font-mono text-[11px] border-b border-base-800/50">{arg.data_type}</td>
                      <td className="px-3 py-1.5 border-b border-base-800/50">
                        <span className={`px-1.5 py-0.5 rounded-sm text-[11px] font-medium uppercase ${
                          arg.mode === "OUT" ? "bg-base-700/60 text-base-200" :
                          arg.mode === "INOUT" ? "bg-base-700/60 text-base-200" :
                          arg.mode === "VARIADIC" ? "bg-base-700/60 text-base-200" :
                          "bg-base-600/20 text-base-400"
                        }`}>
                          {arg.mode}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-base-300 text-[11px] border-b border-base-800/50">
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
          <span className="px-2 py-1 rounded-sm text-[11px] font-medium bg-base-700/50 text-base-200">
            Language: {details.language}
          </span>
          )}
          {details.volatility && (
            <span className={`px-2 py-1 rounded-sm text-[11px] font-medium ${getVolatilityColor()}`}>
              {details.volatility}
            </span>
          )}
          {details.is_aggregate && (
            <span className="px-2 py-1 rounded-sm text-[11px] font-medium bg-base-700/60 text-base-200">
              Aggregate
            </span>
          )}
        </div>

        {/* Definition */}
        {details.definition && (
          <div>
            <h3 className="text-[11px] font-semibold text-base-200 uppercase tracking-[0.07em] mb-1.5">
              Definition
            </h3>
            <div className="bg-base-850 border border-base-700 rounded-sm overflow-hidden">
              <pre className="p-3 text-[12px] text-base-200 font-mono overflow-x-auto whitespace-pre-wrap">
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
    querySql,
    lastQueryContext,
    activeScriptId,
    openScripts,
    openResultTabs,
    popOutResultsToTab,
    saveCurrentResults,
    toggleResultsPanelMinimized,
  } = useAppStore(
    useShallow((state) => ({
      queryResults: state.queryResults,
      queryError: state.queryError,
      isExecuting: state.isExecuting,
      showToast: state.showToast,
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      selectedSchemaObject: state.selectedSchemaObject,
      schemaObjectDetails: state.schemaObjectDetails,
      isLoadingSchemaObjectDetails: state.isLoadingSchemaObjectDetails,
      clearSchemaObjectSelection: state.clearSchemaObjectSelection,
      previewSource: state.previewSource,
      querySql: state.querySql,
      lastQueryContext: state.lastQueryContext,
      activeScriptId: state.activeScriptId,
      openScripts: state.openScripts,
      openResultTabs: state.openResultTabs,
      popOutResultsToTab: state.popOutResultsToTab,
      saveCurrentResults: state.saveCurrentResults,
      toggleResultsPanelMinimized: state.toggleResultsPanelMinimized,
    }))
  );
  
  // Get the active connection's database type
  const activeConnection = connections.find(c => c.id === activeConnectionId);
  const dbType = activeConnection?.db_type;

  const handleFixInChat = async () => {
    if (!queryError) return;

    const aiState = useAiStore.getState();
    if (aiState.isStreaming) {
      showToast("info", "Agent is busy. Wait for the current response to finish.");
      return;
    }

    const activeScript = openScripts.find((script) => script.id === activeScriptId);
    const selectedCell = activeScript?.selectedCellId
      ? activeScript.cells.find((cell) => cell.id === activeScript.selectedCellId)
      : null;
    const selectedCellIndex =
      selectedCell && activeScript
        ? activeScript.cells.findIndex((cell) => cell.id === selectedCell.id) + 1
        : null;
    const activeResultTab = openResultTabs.find((tab) => tab.id === lastQueryContext?.resultTabId);

    const contextLines = [
      `source: ${lastQueryContext?.source ?? "unknown"}`,
      `connection: ${lastQueryContext?.connectionName ?? activeConnection?.name ?? "unknown"} (${lastQueryContext?.connectionId ?? activeConnectionId ?? "unknown"})`,
      `script: ${lastQueryContext?.scriptName ?? activeScript?.name ?? "n/a"} (${lastQueryContext?.scriptId ?? activeScript?.id ?? "n/a"})`,
      `cell: ${
        lastQueryContext?.cellId
          ? `#${lastQueryContext.cellIndex ?? "?"} (${lastQueryContext.cellId})`
          : selectedCell
            ? `#${selectedCellIndex ?? "?"} (${selectedCell.id})`
            : "n/a"
      }`,
      `result tab: ${lastQueryContext?.resultTabName ?? activeResultTab?.name ?? "n/a"} (${lastQueryContext?.resultTabId ?? activeResultTab?.id ?? "n/a"})`,
      `preview source: ${lastQueryContext?.previewSource ?? previewSource ?? "n/a"}`,
    ];

    const sql = lastQueryContext?.sql ?? querySql ?? selectedCell?.sql ?? "";
    const message = [
      "Fix this SQL error.",
      "",
      "Error:",
      queryError,
      "",
      "Context:",
      ...contextLines.map((line) => `- ${line}`),
      "",
      "SQL:",
      "```sql",
      sql || "-- SQL was not captured",
      "```",
      "",
      "Please identify the root cause and provide a corrected query.",
    ].join("\n");

    if (!aiState.isPanelOpen) {
      aiState.togglePanel();
    }

    await aiState.sendMessage(message);
  };

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

  // Show loading state for schema object details
  if (selectedSchemaObject && isLoadingSchemaObjectDetails) {
    return (
      <div className="h-full flex flex-col bg-surface">
        <div className="h-8 border-b border-base-750 shrink-0 flex items-center px-2.5">
          <span className="text-xs text-base-300">Loading details...</span>
          <div className="flex-1" />
          <button
            onClick={clearSchemaObjectSelection}
            className="p-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-base-300 text-sm">
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-500" />
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
        <div className="h-8 border-b border-base-750 shrink-0" />
        <div className="flex-1 flex items-center justify-center text-base-300">
          <div className="flex items-center gap-1.5 text-sm">
            <div className="w-3.5 h-3.5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
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
        <div className="h-8 border-b border-base-750 shrink-0" />
        <div className="flex-1 p-3">
          <div className="flex items-start gap-2 text-red-400">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="font-mono text-sm">
              <div className="font-semibold text-xs uppercase tracking-[0.08em]">{isConnectionError ? "Connection failed" : "Query failed"}</div>
              <div className="mt-1 text-red-300 text-xs whitespace-pre-wrap">
                {isConnectionError ? queryError.replace("Connection failed: ", "") : queryError}
              </div>
              <button
                onClick={() => {
                  handleFixInChat().catch((err) => {
                    showToast("error", `Failed to send error to chat: ${err}`);
                  });
                }}
                className="mt-3 inline-flex items-center gap-1 rounded-sm border border-base-700 px-2 py-1 text-[11px] text-base-200 transition-colors-fast hover:bg-base-800 hover:border-base-600"
                title="Send this error to chat for help fixing it"
              >
                <MessageSquare className="w-3 h-3" />
                <span>Fix in chat</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show results or empty state
  return (
    <ResultsView
      queryResults={queryResults}
      previewSource={previewSource}
      dbType={dbType}
      rightActions={
        <div className="flex items-center gap-1">
          {queryResults ? (
            <>
            <button
              onClick={popOutResultsToTab}
              className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast text-[11px]"
              title="Open result in a new editor tab"
            >
              <Expand className="w-3 h-3" />
              <span>New Tab</span>
            </button>
            <button
              onClick={saveCurrentResults}
              className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast text-[11px]"
              title="Save result"
            >
              <Save className="w-3 h-3" />
              <span>Save</span>
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-[11px]"
              title="Export to CSV"
            >
              <Download className="w-3 h-3" />
              <span>Export</span>
            </button>
            </>
          ) : null}
          <button
            onClick={toggleResultsPanelMinimized}
            className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast text-[11px]"
            title="Minimize results panel"
          >
            <ChevronsDown className="w-3 h-3" />
            <span>Minimize</span>
          </button>
        </div>
      }
    />
  );
}
