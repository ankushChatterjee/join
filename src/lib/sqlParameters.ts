import type { SqlParamDefaults, SqlPlaceholderMode } from "@/stores/types";

export type SqlParamDefaultsCache = Record<string, SqlParamDefaults>;

export interface NamedPlaceholderOccurrence {
  name: string;
  start: number;
  end: number;
}

export interface PositionalPlaceholderOccurrence {
  index: number;
  start: number;
  end: number;
}

export type SqlPlaceholderSpec =
  | {
      mode: "named";
      names: string[];
      occurrences: NamedPlaceholderOccurrence[];
    }
  | {
      mode: "positional";
      count: number;
      occurrences: PositionalPlaceholderOccurrence[];
    };

export function normalizeSqlForParamCache(sql: string): string {
  return sql.trim().replace(/\s+/g, " ").replace(/(?:\s*;\s*)+$/, "").trim();
}

export function buildParamCacheKey(
  connectionId: string,
  sql: string,
  placeholderMode: SqlPlaceholderMode
): string {
  return `${connectionId}::${placeholderMode}::${normalizeSqlForParamCache(sql)}`;
}

export function getParamDefaults(
  cache: SqlParamDefaultsCache,
  key: string,
  spec: SqlPlaceholderSpec
): SqlParamDefaults {
  const cached = cache[key];

  if (spec.mode === "named") {
    const values: Record<string, string | null> = {};
    for (const name of spec.names) {
      values[name] =
        cached?.mode === "named" ? (cached.values[name] ?? null) : null;
    }
    return { mode: "named", values };
  }

  const values: Array<string | null> = Array.from(
    { length: spec.count },
    (_, index) =>
      cached?.mode === "positional" ? (cached.values[index] ?? null) : null
  );
  return { mode: "positional", values };
}

export function setParamDefaults(
  cache: SqlParamDefaultsCache,
  key: string,
  submittedValues: SqlParamDefaults
): SqlParamDefaultsCache {
  return {
    ...cache,
    [key]: submittedValues,
  };
}

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentifierBody(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function tryReadDollarQuoteTag(sql: string, start: number): string | null {
  if (sql[start] !== "$") return null;
  let i = start + 1;
  while (i < sql.length && isIdentifierBody(sql[i])) i += 1;
  if (sql[i] !== "$") return null;
  return sql.slice(start, i + 1);
}

export function analyzeSqlPlaceholders(sql: string): {
  spec: SqlPlaceholderSpec | null;
  error: string | null;
} {
  const namedOccurrences: NamedPlaceholderOccurrence[] = [];
  const positionalOccurrences: PositionalPlaceholderOccurrence[] = [];
  const namedOrder: string[] = [];
  const namedSeen = new Set<string>();
  let positionalIndex = 0;

  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (quote === "'" && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i + 1 < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i = Math.min(sql.length, i + 2);
      continue;
    }

    const dollarTag = tryReadDollarQuoteTag(sql, i);
    if (dollarTag) {
      i += dollarTag.length;
      const closeAt = sql.indexOf(dollarTag, i);
      if (closeAt === -1) break;
      i = closeAt + dollarTag.length;
      continue;
    }

    if (ch === ":" && next && isIdentifierStart(next) && sql[i - 1] !== ":") {
      let j = i + 2;
      while (j < sql.length && isIdentifierBody(sql[j])) j += 1;
      const name = sql.slice(i + 1, j);
      namedOccurrences.push({ name, start: i, end: j });
      if (!namedSeen.has(name)) {
        namedSeen.add(name);
        namedOrder.push(name);
      }
      i = j;
      continue;
    }

    if (
      ch === "?" &&
      next !== "?" &&
      next !== "|" &&
      next !== "&" &&
      sql[i - 1] !== "?"
    ) {
      positionalOccurrences.push({ index: positionalIndex, start: i, end: i + 1 });
      positionalIndex += 1;
      i += 1;
      continue;
    }

    i += 1;
  }

  if (namedOccurrences.length > 0 && positionalOccurrences.length > 0) {
    return {
      spec: null,
      error: "Cannot mix named (:name) and positional (?) SQL parameters in one query.",
    };
  }

  if (namedOccurrences.length > 0) {
    return {
      spec: {
        mode: "named",
        names: namedOrder,
        occurrences: namedOccurrences,
      },
      error: null,
    };
  }

  if (positionalOccurrences.length > 0) {
    return {
      spec: {
        mode: "positional",
        count: positionalOccurrences.length,
        occurrences: positionalOccurrences,
      },
      error: null,
    };
  }

  return { spec: null, error: null };
}

function escapeSqlLiteral(value: string | null): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

export function applySqlParams(
  sql: string,
  spec: SqlPlaceholderSpec,
  values: SqlParamDefaults
): string {
  const parts: string[] = [];
  let cursor = 0;

  if (spec.mode === "named") {
    if (values.mode !== "named") {
      throw new Error("Expected named parameter values.");
    }

    for (const occurrence of spec.occurrences) {
      if (!(occurrence.name in values.values)) {
        throw new Error(`Missing value for :${occurrence.name}`);
      }
      parts.push(sql.slice(cursor, occurrence.start));
      parts.push(escapeSqlLiteral(values.values[occurrence.name]));
      cursor = occurrence.end;
    }
  } else {
    if (values.mode !== "positional") {
      throw new Error("Expected positional parameter values.");
    }
    for (const occurrence of spec.occurrences) {
      if (occurrence.index >= values.values.length) {
        throw new Error(`Missing value for parameter #${occurrence.index + 1}`);
      }
      parts.push(sql.slice(cursor, occurrence.start));
      parts.push(escapeSqlLiteral(values.values[occurrence.index]));
      cursor = occurrence.end;
    }
  }

  parts.push(sql.slice(cursor));
  return parts.join("");
}
