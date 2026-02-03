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
