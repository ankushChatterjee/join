/**
 * Database-specific type handlers for special column types
 * 
 * This module provides a modular way to detect and handle special data types
 * (like JSON) across different database systems.
 */

import type { DatabaseType } from "@/stores/types";

/**
 * JSON type names for each database system
 * Only databases with native JSON types are included here.
 * Add new database types here when implementing new database support.
 */
const JSON_TYPE_NAMES: Partial<Record<DatabaseType, string[]>> = {
  postgresql: ["JSON", "JSONB", "json", "jsonb"],
  mysql: ["JSON", "json"],
  // SQLite does NOT have native JSON types - JSON functions work on TEXT columns
};

/**
 * Check if a database has native JSON type support
 */
export function hasNativeJsonSupport(dbType?: DatabaseType): boolean {
  if (!dbType) return false;
  return dbType in JSON_TYPE_NAMES;
}

/**
 * Check if a column type represents a JSON type for the given database
 * Only returns true if the database has native JSON support
 */
export function isJsonType(typeName: string, dbType?: DatabaseType): boolean {
  if (!typeName || !dbType) return false;
  
  // Only check for databases that have native JSON support
  const jsonTypes = JSON_TYPE_NAMES[dbType];
  if (!jsonTypes) return false;
  
  const normalizedType = typeName.toUpperCase();
  return jsonTypes.some(t => t.toUpperCase() === normalizedType);
}

/**
 * Check if a value looks like JSON (object or array)
 */
export function isJsonValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  
  // If it's already an object or array, it's JSON
  if (typeof value === "object") return true;
  
  // If it's a string, try to detect JSON structure
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
           (trimmed.startsWith("[") && trimmed.endsWith("]"));
  }
  
  return false;
}

/**
 * Format a JSON value for display in a table cell (truncated preview)
 */
export function formatJsonPreview(value: unknown, maxLength: number = 50): string {
  try {
    let jsonStr: string;
    
    if (typeof value === "string") {
      // Try to parse and re-stringify for consistent formatting
      const parsed = JSON.parse(value);
      jsonStr = JSON.stringify(parsed);
    } else if (typeof value === "object") {
      jsonStr = JSON.stringify(value);
    } else {
      return String(value);
    }
    
    // Truncate for display
    if (jsonStr.length > maxLength) {
      return jsonStr.slice(0, maxLength) + "…";
    }
    return jsonStr;
  } catch {
    // If parsing fails, just return string representation
    return String(value).slice(0, maxLength) + (String(value).length > maxLength ? "…" : "");
  }
}

/**
 * Format a JSON value for display in the popover (prettified)
 */
export function formatJsonPretty(value: unknown): string {
  try {
    let parsed: unknown;
    
    if (typeof value === "string") {
      parsed = JSON.parse(value);
    } else if (typeof value === "object") {
      parsed = value;
    } else {
      return String(value);
    }
    
    return JSON.stringify(parsed, null, 2);
  } catch {
    // If parsing fails, return as-is
    return String(value);
  }
}

/**
 * Type handler result for special column types
 */
export interface TypeHandlerResult {
  isSpecialType: boolean;
  displayValue: string;
  popoverValue: string;
  typeLabel?: string;
}

/**
 * Get special type handling for a cell value
 * Only applies special handling for databases with native type support
 */
export function getTypeHandler(
  value: unknown,
  typeName: string,
  dbType?: DatabaseType
): TypeHandlerResult | null {
  // Only apply JSON handling for databases with native JSON support
  if (!hasNativeJsonSupport(dbType)) return null;
  
  // Check for JSON type
  if (isJsonType(typeName, dbType) || isJsonValue(value)) {
    return {
      isSpecialType: true,
      displayValue: formatJsonPreview(value, 50),
      popoverValue: formatJsonPretty(value),
      typeLabel: "json",
    };
  }
  
  return null;
}

/**
 * Check if a value is a PostgreSQL composite type (returned from our backend)
 * Our backend returns composite types as { _type, _raw, _display } objects
 */
export function isCompositeTypeValue(value: unknown): value is CompositeTypeValue {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj._display === "composite" && typeof obj._raw === "string" && typeof obj._type === "string";
}

export interface CompositeTypeValue {
  _type: string;
  _raw: string;
  _display: "composite";
}

/**
 * Parse a PostgreSQL composite type string (a,b,c) into an array of values
 * Handles quoted values and nested structures
 */
export function parseCompositeTypeString(raw: string): string[] {
  // Remove outer parentheses
  if (!raw.startsWith("(") || !raw.endsWith(")")) {
    return [raw];
  }
  
  const inner = raw.slice(1, -1);
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  let depth = 0;
  
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    
    if (char === '"' && (i === 0 || inner[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
      // Don't include quotes in the output
      continue;
    }
    
    if (!inQuotes) {
      if (char === "(") {
        depth++;
        current += char;
        continue;
      }
      if (char === ")") {
        depth--;
        current += char;
        continue;
      }
      if (char === "," && depth === 0) {
        values.push(current);
        current = "";
        continue;
      }
    }
    
    current += char;
  }
  
  // Push the last value
  values.push(current);
  
  return values;
}

/**
 * Format a composite type value for preview display
 */
export function formatCompositePreview(value: CompositeTypeValue, maxLength: number = 50): string {
  const values = parseCompositeTypeString(value._raw);
  const preview = values.join(", ");
  if (preview.length > maxLength) {
    return preview.slice(0, maxLength) + "…";
  }
  return preview;
}

/**
 * Format a composite type value for popover display
 * Returns a pretty-printed version with field indices
 */
export function formatCompositePretty(value: CompositeTypeValue): string {
  const values = parseCompositeTypeString(value._raw);
  const lines = values.map((v, i) => `[${i}]: ${v || "(empty)"}`);
  return `Type: ${value._type}\n\n${lines.join("\n")}`;
}

// ============================================================================
// Array Type Handling
// ============================================================================

/**
 * Check if a column type represents an array type
 * PostgreSQL: type ends with [] or internal name starts with _
 * MySQL/SQLite: No native arrays, detect by value instead
 */
export function isArrayType(typeName: string, dbType?: DatabaseType): boolean {
  if (!typeName) return false;
  const normalized = typeName.toLowerCase();
  
  if (dbType === "postgresql") {
    // PostgreSQL array types end with [] or have internal names starting with _
    return normalized.endsWith("[]") || normalized.startsWith("_");
  }
  
  // MySQL and SQLite don't have native array types
  // Arrays are stored as JSON - detect by value instead
  return false;
}

/**
 * Check if a value is an array (works for all databases)
 */
export function isArrayValue(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Format an array value for display in a table cell (truncated preview)
 */
export function formatArrayPreview(value: unknown[], maxLength: number = 50): string {
  if (value.length === 0) {
    return "[]";
  }
  
  // Try to create a compact preview
  const itemsPreview = value
    .slice(0, 5) // Show at most 5 items
    .map(item => {
      if (item === null) return "null";
      if (typeof item === "string") return `"${item}"`;
      if (typeof item === "object") return JSON.stringify(item);
      return String(item);
    })
    .join(", ");
  
  const hasMore = value.length > 5;
  const preview = hasMore 
    ? `[${itemsPreview}, …]`
    : `[${itemsPreview}]`;
  
  if (preview.length > maxLength) {
    return `[${value.length} items]`;
  }
  
  return preview;
}

/**
 * Format an array value for popover display (as JSON for copying)
 */
export function formatArrayPretty(value: unknown[]): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Format a single array item for display
 */
export function formatArrayItem(item: unknown): string {
  if (item === null) {
    return "null";
  } else if (typeof item === "object") {
    return JSON.stringify(item);
  } else if (typeof item === "string") {
    return `"${item}"`;
  } else {
    return String(item);
  }
}
