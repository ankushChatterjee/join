import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 32;

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
}

export function DataTable<TData>({ data, columns }: DataTableProps<TData>) {
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
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
      <div className="h-full flex items-center justify-center text-base-500 text-sm">
        No data to display
      </div>
    );
  }

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={tableContainerRef} className="h-full overflow-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-8 px-3 text-left font-medium text-base-300 bg-base-850 border-b border-border-subtle whitespace-nowrap"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </th>
              ))}
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
                  "border-b border-base-800/50 hover:bg-base-800/30",
                  virtualRow.index % 2 === 0 ? "bg-surface" : "bg-surface/50"
                )}
                style={{ height: ROW_HEIGHT }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="h-8 px-3 text-base-200 whitespace-nowrap font-mono text-xs"
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
