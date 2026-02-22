import { useMemo } from "react";
import { Clock, Rows3, Table2 } from "lucide-react";
import { DataTable } from "./DataTable";
import { createColumnsFromData } from "./columnUtils";
import type { QueryResult, DatabaseType } from "@/stores/types";

interface ResultsViewProps {
  queryResults: QueryResult | null;
  previewSource: string | null;
  dbType?: DatabaseType;
  rightActions?: import("react").ReactNode;
  emptyMessage?: string;
}

export function ResultsView({
  queryResults,
  previewSource,
  dbType,
  rightActions,
  emptyMessage = "Run a query to see results",
}: ResultsViewProps) {
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

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="h-8 flex items-center gap-1 px-2.5 border-b border-base-750 shrink-0">
        {queryResults ? (
          <>
            {previewSource && (
              <div className="flex items-center gap-1 text-[11px] text-base-200 mr-2.5">
                <Table2 className="w-3 h-3 text-accent-500" />
                <span className="font-medium">{previewSource}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-[11px] text-base-300">
              <div className="flex items-center gap-1">
                <Rows3 className="w-3 h-3" />
                <span>
                  <span className="text-base-200">{queryResults.row_count}</span> rows
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>
                  <span className="text-base-200">{queryResults.execution_time_ms}</span>ms
                </span>
              </div>
            </div>
            <div className="flex-1" />
            {rightActions}
          </>
        ) : (
          <>
            <div className="text-[11px] text-base-300 uppercase tracking-[0.08em]">Results</div>
            <div className="flex-1" />
            {rightActions}
          </>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {queryResults ? (
          <DataTable data={tableData} columns={columns} />
        ) : (
          <div className="h-full flex items-center justify-center text-base-300 text-sm">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
