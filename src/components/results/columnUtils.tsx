import { createColumnHelper, ColumnDef } from "@tanstack/react-table";
import { useRef, useState, useEffect } from "react";
import { X, Copy, Check, Braces, Layers, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ColumnDef as SqlColumnDef, DatabaseType } from "@/stores/types";
import { 
  isJsonType, 
  formatJsonPreview, 
  formatJsonPretty, 
  isJsonValue, 
  hasNativeJsonSupport,
  isCompositeTypeValue,
  formatCompositePreview,
  formatCompositePretty,
  isArrayValue,
  formatArrayPreview,
  formatArrayPretty,
  formatArrayItem,
} from "@/lib/typeHandlers";

const TRUNCATE_LENGTH = 100;
const JSON_PREVIEW_LENGTH = 50;

// Cell value popover for viewing full content
function CellPopover({
  value,
  sqlType,
  isPrimaryKey,
  isIndexed,
  isJson,
  arrayLength,
  arrayItems,
  onClose,
  anchorRect,
}: {
  value: string;
  sqlType: string;
  isPrimaryKey?: boolean;
  isIndexed?: boolean;
  isJson?: boolean;
  arrayLength?: number;
  arrayItems?: unknown[];
  onClose: () => void;
  anchorRect: DOMRect;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!popoverRef.current) return;

    const popoverHeight = popoverRef.current.offsetHeight;
    const popoverWidth = popoverRef.current.offsetWidth;

    let top = anchorRect.top - popoverHeight - 8;
    let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;

    if (top < 8) {
      top = anchorRect.bottom + 8;
    }

    left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));

    setPosition({ top, left });
    setIsPositioned(true);
  }, [anchorRect]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const isLongContent = value.length > 500;
  
  // Format value for display - prettify if JSON
  const displayContent = isJson ? formatJsonPretty(value) : value;

  return (
    <div
      ref={popoverRef}
      className={cn(
        "fixed z-50",
        isPositioned ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      style={{ top: position.top, left: position.left }}
    >
      <div className="bg-base-850 border border-base-700 rounded-lg shadow-xl shadow-black/40 overflow-hidden max-w-[500px] min-w-[200px]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-base-700/50 bg-base-800/50">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-base-700 text-[10px] font-mono text-base-300 uppercase">
              {sqlType}
            </span>
            {isPrimaryKey && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-[10px] font-semibold text-amber-400">
                PK
              </span>
            )}
            {isIndexed && !isPrimaryKey && (
              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-[10px] font-semibold text-blue-400">
                IDX
              </span>
            )}
            <span className="text-xs text-base-300">
              {arrayLength !== undefined 
                ? `${arrayLength.toLocaleString()} elements`
                : `${value.length.toLocaleString()} chars`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-base-700/50 text-base-300 hover:text-base-100 transition-colors"
              title="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-base-700/50 text-base-300 hover:text-base-100 transition-colors"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          className={cn(
            "overflow-auto panel-scroll",
            isLongContent || isJson ? "max-h-[400px]" : "max-h-[200px]",
            !arrayItems && "p-3"
          )}
        >
          {arrayItems ? (
            <div className="divide-y divide-base-700/50">
              {arrayItems.map((item, i) => (
                <div key={i} className="px-3 py-2 flex gap-3">
                  <span className="text-base-300 text-xs font-mono shrink-0">[{i}]</span>
                  <span className="text-xs text-base-200 font-mono break-all">
                    {formatArrayItem(item)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <pre
              className="text-xs text-base-200 whitespace-pre-wrap break-all font-mono leading-relaxed"
            >
              {displayContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// Clickable cell component - ALL cells are clickable
function ClickableCell({
  value,
  displayValue,
  sqlType,
  isPrimaryKey,
  isIndexed,
  isJson,
  arrayLength,
  arrayItems,
  className,
}: {
  value: string;
  displayValue: React.ReactNode;
  sqlType: string;
  isPrimaryKey?: boolean;
  isIndexed?: boolean;
  isJson?: boolean;
  arrayLength?: number;
  arrayItems?: unknown[];
  className?: string;
}) {
  const [popoverAnchor, setPopoverAnchor] = useState<DOMRect | null>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  const handleClick = () => {
    if (cellRef.current) {
      setPopoverAnchor(cellRef.current.getBoundingClientRect());
    }
  };

  return (
    <>
      <div
        ref={cellRef}
        onClick={handleClick}
        className={cn(
          "cursor-pointer hover:text-accent-400 transition-colors max-w-[300px] truncate",
          className
        )}
        title="Click to view"
      >
        {displayValue}
      </div>
      {popoverAnchor && (
        <CellPopover
          value={value}
          sqlType={sqlType}
          isPrimaryKey={isPrimaryKey}
          isIndexed={isIndexed}
          isJson={isJson}
          arrayLength={arrayLength}
          arrayItems={arrayItems}
          anchorRect={popoverAnchor}
          onClose={() => setPopoverAnchor(null)}
        />
      )}
    </>
  );
}

// JSON cell display component
function JsonCellDisplay({ preview }: { preview: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Braces className="w-3 h-3 shrink-0 text-base-300" />
      <span className="truncate">{preview}</span>
    </span>
  );
}

// Composite type cell display component
function CompositeTypeCellDisplay({ preview, typeName }: { preview: string; typeName: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Layers className="w-3 h-3 shrink-0 text-orange-400" />
      <span className="text-orange-300 text-[10px] font-medium uppercase">{typeName}</span>
      <span className="truncate text-base-300">{preview}</span>
    </span>
  );
}

// Array cell display component
function ArrayCellDisplay({ preview, count }: { preview: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <List className="w-3 h-3 shrink-0 text-base-300" />
      <span className="text-base-300 text-[10px] font-medium">[{count}]</span>
      <span className="truncate">{preview}</span>
    </span>
  );
}

// Helper to create columns dynamically from data with SQL types
export function createColumnsFromData<T extends Record<string, unknown>>(
  data: T[],
  sqlColumns?: SqlColumnDef[],
  dbType?: DatabaseType
): ColumnDef<T, unknown>[] {
  if (data.length === 0) return [];

  const columnHelper = createColumnHelper<T>();
  const keys = Object.keys(data[0]);

  return keys.map((key, index) =>
    columnHelper.accessor((row) => row[key], {
      id: key,
      header: key,
      cell: (info) => {
        const value = info.getValue();
        const colDef = sqlColumns?.[index];
        const sqlType = colDef?.type_name ?? "unknown";
        const isPrimaryKey = colDef?.is_primary_key;
        const isIndexed = colDef?.is_indexed;
        
        // Check if this is a JSON type column - only for databases with native JSON support
        const dbHasJsonSupport = hasNativeJsonSupport(dbType);
        const isJsonColumn = isJsonType(sqlType, dbType);
        // Only treat as JSON if the database has native support AND it's a JSON column or value
        const valueIsJson = dbHasJsonSupport && isJsonValue(value);
        const shouldTreatAsJson = isJsonColumn || valueIsJson;

        if (value === null || value === undefined) {
          return (
            <ClickableCell
              value="NULL"
              sqlType={sqlType}
              isPrimaryKey={isPrimaryKey}
              isIndexed={isIndexed}
              displayValue={<span className="text-base-300 italic">NULL</span>}
            />
          );
        }
        
        // Handle PostgreSQL composite types (returned as special object from backend)
        if (isCompositeTypeValue(value)) {
          const preview = formatCompositePreview(value, 40);
          const fullValue = formatCompositePretty(value);
          return (
            <ClickableCell
              value={fullValue}
              sqlType={value._type}
              isPrimaryKey={isPrimaryKey}
              isIndexed={isIndexed}
              displayValue={<CompositeTypeCellDisplay preview={preview} typeName={value._type} />}
            />
          );
        }
        
        // Handle arrays (PostgreSQL native arrays, or JSON arrays from MySQL/SQLite)
        if (isArrayValue(value)) {
          const preview = formatArrayPreview(value, 40);
          const fullValue = formatArrayPretty(value);
          return (
            <ClickableCell
              value={fullValue}
              sqlType={sqlType}
              isPrimaryKey={isPrimaryKey}
              isIndexed={isIndexed}
              isJson={true}
              arrayLength={value.length}
              arrayItems={value}
              displayValue={<ArrayCellDisplay preview={preview} count={value.length} />}
            />
          );
        }
        
        // Handle JSON types specially (non-array objects)
        if (shouldTreatAsJson && typeof value === "object") {
          const jsonPreview = formatJsonPreview(value, JSON_PREVIEW_LENGTH);
          const fullValue = JSON.stringify(value);
          return (
            <ClickableCell
              value={fullValue}
              sqlType={sqlType}
              isPrimaryKey={isPrimaryKey}
              isIndexed={isIndexed}
              isJson={true}
              displayValue={<JsonCellDisplay preview={jsonPreview} />}
            />
          );
        }
        
        if (typeof value === "boolean") {
          return (
            <ClickableCell
              value={value ? "true" : "false"}
              sqlType={sqlType}
              isPrimaryKey={isPrimaryKey}
              isIndexed={isIndexed}
              displayValue={
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-medium",
                    value
                      ? "bg-success/20 text-success"
                      : "bg-base-700 text-base-300"
                  )}
                >
                  {value ? "true" : "false"}
                </span>
              }
            />
          );
        }
        if (typeof value === "number") {
          return (
            <ClickableCell
              value={String(value)}
              sqlType={sqlType}
              isPrimaryKey={isPrimaryKey}
              isIndexed={isIndexed}
              displayValue={<span className="text-accent-500">{String(value)}</span>}
            />
          );
        }

        const strValue = String(value);
        
        // Check if string value is JSON (e.g., MySQL may return JSON as string)
        if (shouldTreatAsJson && (strValue.startsWith("{") || strValue.startsWith("["))) {
          const jsonPreview = formatJsonPreview(strValue, JSON_PREVIEW_LENGTH);
          return (
            <ClickableCell
              value={strValue}
              sqlType={sqlType}
              isPrimaryKey={isPrimaryKey}
              isIndexed={isIndexed}
              isJson={true}
              displayValue={<JsonCellDisplay preview={jsonPreview} />}
            />
          );
        }
        
        const isTruncated = strValue.length > TRUNCATE_LENGTH;
        const displayStr = isTruncated
          ? strValue.slice(0, TRUNCATE_LENGTH) + "…"
          : strValue;

        return (
          <ClickableCell
            value={strValue}
            sqlType={sqlType}
            isPrimaryKey={isPrimaryKey}
            isIndexed={isIndexed}
            displayValue={displayStr}
          />
        );
      },
    })
  ) as ColumnDef<T, unknown>[];
}
