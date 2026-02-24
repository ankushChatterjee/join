import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 34;

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
}

export function DataTable<TData>({ data, columns }: DataTableProps<TData>) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-base-300 text-sm">
        No data to display
      </div>
    );
  }

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={tableContainerRef} className="h-full overflow-auto panel-scroll results-scroll">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDirection = header.column.getIsSorted();
                
                return (
                    <th
                      key={header.id}
                      className={cn(
                      "h-8 px-2.5 text-left font-semibold text-[12px] text-base-100 bg-base-900 border-b border-base-700 whitespace-nowrap tracking-[0.02em]",
                      canSort && "cursor-pointer select-none hover:bg-base-850 transition-colors-fast"
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                      {canSort && (
                        <span className="ml-1 text-base-300">
                          {sortDirection === "asc" ? (
                            <ChevronUp className="w-3 h-3 text-accent-400" />
                          ) : sortDirection === "desc" ? (
                            <ChevronDown className="w-3 h-3 text-accent-400" />
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 opacity-70" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {virtualRows.length > 0 && virtualRows[0].start > 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{ height: virtualRows[0].start }}
              />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <tr
                key={row.id}
                data-index={virtualRow.index}
                className={cn(
                  "border-b border-base-800/70 hover:bg-base-850/90",
                  virtualRow.index % 2 === 0 ? "bg-base-900/65" : "bg-base-900/45"
                )}
                style={{ height: ROW_HEIGHT }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="h-8 px-2.5 text-base-100 whitespace-nowrap font-mono text-[12px]"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
          {virtualRows.length > 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  height:
                    virtualizer.getTotalSize() -
                    (virtualRows[virtualRows.length - 1]?.end ?? 0),
                }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
