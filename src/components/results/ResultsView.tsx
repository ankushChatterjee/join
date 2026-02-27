import { useMemo, useState } from "react";
import { Clock, Rows3, Table2, LayoutList, TableProperties } from "lucide-react";
import { DataTable } from "./DataTable";
import { createColumnsFromData } from "./columnUtils";
import type { QueryResult, DatabaseType } from "@/stores/types";
import { cn } from "@/lib/utils";

interface ResultsViewProps {
  queryResults: QueryResult | null;
  previewSource: string | null;
  dbType?: DatabaseType;
  rightActions?: import("react").ReactNode;
  emptyMessage?: string;
}

function SchemaView({ queryResults }: { queryResults: QueryResult }) {
  return (
    <div className="h-full overflow-auto panel-scroll">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="px-2.5 py-1.5 text-left font-semibold text-[11px] text-base-300 bg-base-900 border-b border-base-700 w-8">#</th>
            <th className="px-2.5 py-1.5 text-left font-semibold text-[11px] text-base-300 bg-base-900 border-b border-base-700">Column</th>
            <th className="px-2.5 py-1.5 text-left font-semibold text-[11px] text-base-300 bg-base-900 border-b border-base-700">Type</th>
            <th className="px-2.5 py-1.5 text-left font-semibold text-[11px] text-base-300 bg-base-900 border-b border-base-700 w-14">PK</th>
            <th className="px-2.5 py-1.5 text-left font-semibold text-[11px] text-base-300 bg-base-900 border-b border-base-700 w-16">Indexed</th>
          </tr>
        </thead>
        <tbody>
          {queryResults.columns.map((col, i) => (
            <tr
              key={i}
              className={cn(
                "border-b border-base-800/70 hover:bg-base-850/90",
                i % 2 === 0 ? "bg-base-900/65" : "bg-base-900/45"
              )}
            >
              <td className="px-2.5 py-1.5 text-base-400 font-mono text-[11px]">{i + 1}</td>
              <td className="px-2.5 py-1.5 text-base-100 font-mono text-[12px] font-medium">{col.name}</td>
              <td className="px-2.5 py-1.5">
                <span className="px-1.5 py-0.5 rounded-sm bg-base-800 font-mono text-[11px] text-accent-400">
                  {col.type_name || "—"}
                </span>
              </td>
              <td className="px-2.5 py-1.5">
                {col.is_primary_key ? (
                  <span className="px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-[11px] font-semibold text-amber-400">
                    PK
                  </span>
                ) : (
                  <span className="text-base-600 text-[11px]">—</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {col.is_indexed ? (
                  <span className="px-1.5 py-0.5 rounded-sm bg-base-700/60 text-[11px] font-semibold text-base-200">
                    IDX
                  </span>
                ) : (
                  <span className="text-base-600 text-[11px]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-base-400">
        {queryResults.columns.length} column{queryResults.columns.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export function ResultsView({
  queryResults,
  previewSource,
  dbType,
  rightActions,
  emptyMessage = "Run a query to see results",
}: ResultsViewProps) {
  const [activeTab, setActiveTab] = useState<"results" | "schema">("results");

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
            {/* Tab strip */}
            <div className="flex items-center gap-0.5 mr-2">
              <button
                onClick={() => setActiveTab("results")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] transition-colors-fast",
                  activeTab === "results"
                    ? "bg-base-800 text-base-100"
                    : "text-base-300 hover:text-base-100 hover:bg-base-850"
                )}
              >
                <LayoutList className="w-3 h-3" />
                <span>Results</span>
              </button>
              <button
                onClick={() => setActiveTab("schema")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] transition-colors-fast",
                  activeTab === "schema"
                    ? "bg-base-800 text-base-100"
                    : "text-base-300 hover:text-base-100 hover:bg-base-850"
                )}
              >
                <TableProperties className="w-3 h-3" />
                <span>Schema</span>
              </button>
            </div>
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
          activeTab === "results" ? (
            <DataTable data={tableData} columns={columns} />
          ) : (
            <SchemaView queryResults={queryResults} />
          )
        ) : (
          <div className="h-full flex items-center justify-center text-base-300 text-sm">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
