import { useState, useMemo } from "react";
import { Clock, Rows3, AlertCircle, Download } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { DataTable } from "./DataTable";
import { createColumnsFromData } from "./columnUtils";

export function ResultsPanel() {
  const [isExporting, setIsExporting] = useState(false);
  const { queryResults, queryError, isExecuting, showToast, activeConnectionId, connections } = useAppStore();
  
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

  // Show loading state
  if (isExecuting) {
    return (
      <div className="h-full flex flex-col bg-surface">
        <div className="h-9 border-b border-border-subtle shrink-0" />
        <div className="flex-1 flex items-center justify-center text-base-500">
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
    return (
      <div className="h-full flex flex-col bg-surface">
        <div className="h-9 border-b border-border-subtle shrink-0" />
        <div className="flex-1 p-4">
          <div className="flex items-start gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="font-mono text-sm">
              <div className="font-medium">Query failed</div>
              <div className="mt-1 text-red-400/80 whitespace-pre-wrap">{queryError}</div>
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
            {/* Stats */}
            <div className="flex items-center gap-4 text-xs text-base-500">
              <div className="flex items-center gap-1.5">
                <Rows3 className="w-3.5 h-3.5" />
                <span>
                  <span className="text-base-300">{queryResults.row_count}</span> rows
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  <span className="text-base-300">{queryResults.execution_time_ms}</span>ms
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
          <div className="text-xs text-base-500">Results</div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {queryResults ? (
          <DataTable data={tableData} columns={columns} />
        ) : (
          <div className="h-full flex items-center justify-center text-base-500 text-sm">
            Run a query to see results
          </div>
        )}
      </div>
    </div>
  );
}
