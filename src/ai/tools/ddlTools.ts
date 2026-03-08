// ============================================================================
// AI Agent - DDL Validation Tool
// ============================================================================
//
// validate_ddl is the structural linter for DDL statements, analogous to
// lint_sql_safety for SELECT queries.
//
// It performs regex-based analysis of CREATE TABLE / ALTER TABLE blocks,
// checking for structural issues (missing PKs, unindexed FK columns, bad
// types, naming violations, missing audit columns) and returns severity-
// annotated findings the agent must resolve before writing to the editor.

import { tool } from "ai";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Internal check types
// ---------------------------------------------------------------------------

interface DdlCheck {
  rule_id: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  table?: string;
  column?: string;
  message: string;
  suggestion: string;
}

// ---------------------------------------------------------------------------
// Regex helpers
// ---------------------------------------------------------------------------

/** Strip SQL single-line and block comments */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Normalise whitespace for easier regex matching */
function normalise(sql: string): string {
  return stripComments(sql).replace(/\s+/g, " ").trim();
}

/**
 * Extract CREATE TABLE blocks from a DDL string.
 * Returns an array of { name, body } where body is the content inside the
 * outer parentheses of the CREATE TABLE statement.
 */
function extractCreateTableBlocks(sql: string): Array<{ name: string; body: string }> {
  const results: Array<{ name: string; body: string }> = [];
  // Match CREATE TABLE [IF NOT EXISTS] schema.table ( ... )
  const createTableRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_"."]+)\s*\(/gi;

  let match: RegExpExecArray | null;
  while ((match = createTableRe.exec(sql)) !== null) {
    const tableName = match[1].replace(/"/g, "");
    const openParen = match.index + match[0].length - 1;
    // Walk forward to find the matching closing paren
    let depth = 0;
    let i = openParen;
    for (; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = sql.slice(openParen + 1, i);
    results.push({ name: tableName, body });
  }
  return results;
}

/** Return the short table name (without schema prefix) */
function shortName(qualified: string): string {
  const dot = qualified.lastIndexOf(".");
  return dot >= 0 ? qualified.slice(dot + 1) : qualified;
}

/** Check if a string is snake_case (lowercase letters, digits, underscores only) */
function isSnakeCase(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

/**
 * Extract column definitions from a CREATE TABLE body string.
 * Returns a list of { name, definition } pairs.
 * Skips inline table constraints (PRIMARY KEY (...), FOREIGN KEY ..., UNIQUE (...), CHECK ...).
 */
function extractColumns(body: string): Array<{ name: string; definition: string }> {
  const columns: Array<{ name: string; definition: string }> = [];

  // Split on commas that are NOT inside parentheses
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const tableConstraintRe =
    /^\s*(primary\s+key|foreign\s+key|unique|check|constraint)\b/i;

  for (const part of parts) {
    if (tableConstraintRe.test(part)) continue;
    // First token is the column name (possibly quoted)
    const tokenMatch = part.match(/^\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+(.+)$/s);
    if (!tokenMatch) continue;
    columns.push({ name: tokenMatch[1], definition: tokenMatch[2] });
  }

  return columns;
}

// ---------------------------------------------------------------------------
// validate_ddl tool
// ---------------------------------------------------------------------------

export const validateDdl = tool({
  description:
    "Run structural lint checks on DDL statements (CREATE TABLE, ALTER TABLE). " +
    "Call this after drafting DDL and before writing it to the editor with add_cell. " +
    "Resolves HIGH-severity issues before proceeding. Does not require a database connection.",
  inputSchema: z.object({
    ddl: z.string().describe("The DDL statement(s) to validate (CREATE TABLE, ALTER TABLE, etc.)"),
    dialect: z
      .enum(["postgresql", "mysql", "sqlite"])
      .optional()
      .default("postgresql")
      .describe("SQL dialect — defaults to postgresql"),
  }),
  execute: async ({ ddl, dialect = "postgresql" }) => {
    const checks: DdlCheck[] = [];
    const lower = normalise(ddl).toLowerCase();

    const push = (check: DdlCheck) => checks.push(check);

    // -----------------------------------------------------------------------
    // FULL-TEXT checks (apply to the whole DDL blob)
    // -----------------------------------------------------------------------

    // SERIAL / BIGSERIAL / SMALLSERIAL — prefer IDENTITY (Postgres)
    if (dialect === "postgresql" && /\b(bigserial|smallserial|serial)\b/.test(lower)) {
      push({
        rule_id: "prefer-identity-over-serial",
        severity: "MEDIUM",
        message:
          "SERIAL / BIGSERIAL / SMALLSERIAL are shorthand aliases that create sequences implicitly. " +
          "GENERATED ALWAYS AS IDENTITY is the SQL-standard replacement.",
        suggestion:
          "Replace `id BIGSERIAL PRIMARY KEY` with `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`.",
      });
    }

    // uuid_generate_v4() — random UUID causes index fragmentation on large tables
    if (/uuid_generate_v4\s*\(\s*\)/.test(lower)) {
      push({
        rule_id: "prefer-uuid-v7-over-v4",
        severity: "MEDIUM",
        message:
          "uuid_generate_v4() generates random (non-sequential) UUIDs which cause B-tree index " +
          "fragmentation on large tables.",
        suggestion:
          "Use uuid_generate_v7() (requires pg_uuidv7 extension) for time-ordered UUIDs, " +
          "or use BIGINT GENERATED ALWAYS AS IDENTITY if distribution is not required.",
      });
    }

    // VARCHAR(n) — Postgres TEXT is preferred (no performance difference, more flexible)
    if (dialect === "postgresql" && /\bvarchar\s*\(\s*\d+\s*\)/.test(lower)) {
      push({
        rule_id: "prefer-text-over-varchar",
        severity: "MEDIUM",
        message:
          "VARCHAR(n) with a length limit has no storage or performance advantage over TEXT in " +
          "PostgreSQL. The constraint just adds an error-prone magic number.",
        suggestion:
          "Use TEXT for variable-length strings. Add a CHECK constraint if you need a maximum length: " +
          "`CHECK (char_length(col) <= 255)`.",
      });
    }

    // CHARACTER VARYING(n) — same issue
    if (dialect === "postgresql" && /\bcharacter\s+varying\s*\(\s*\d+\s*\)/.test(lower)) {
      push({
        rule_id: "prefer-text-over-varchar",
        severity: "MEDIUM",
        message: "CHARACTER VARYING(n) has no advantage over TEXT in PostgreSQL.",
        suggestion: "Use TEXT. Add a CHECK constraint for length enforcement if needed.",
      });
    }

    // CHAR(n) — blank-padding footgun
    if (/\bchar\s*\(\s*\d+\s*\)/.test(lower) && !/varchar/.test(lower)) {
      push({
        rule_id: "avoid-fixed-char",
        severity: "LOW",
        message: "CHAR(n) pads values with spaces, which can cause subtle comparison bugs.",
        suggestion: "Use TEXT or VARCHAR (without length) unless you have a strict fixed-width requirement.",
      });
    }

    // FLOAT / REAL / DOUBLE PRECISION — floating-point is imprecise for money/measures
    if (/\b(float|real|double\s+precision)\b/.test(lower)) {
      push({
        rule_id: "avoid-float-for-precision",
        severity: "LOW",
        message:
          "FLOAT / REAL / DOUBLE PRECISION use IEEE 754 binary floating point, which cannot " +
          "represent most decimal fractions exactly. This causes rounding errors in financial or " +
          "measurement data.",
        suggestion:
          "Use NUMERIC / DECIMAL for money and precise measurements. Use FLOAT only for scientific data where approximate values are acceptable.",
      });
    }

    // -----------------------------------------------------------------------
    // PER-TABLE checks
    // -----------------------------------------------------------------------
    // Parse the DDL with original casing so column names are case-preserved.
    // The lowercased `lower` string above is used only for full-text regex checks.
    const cleanDdl = stripComments(ddl);
    const tables = extractCreateTableBlocks(cleanDdl);

    // Collect all column names targeted by CREATE INDEX in the full DDL blob
    // so we can check FK coverage. Format: Set<"tablename.columnname">
    const indexedColumns = new Set<string>();
    const createIndexRe =
      /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:\w+\s+)?on\s+([a-z0-9_".]+)\s*\(([^)]+)\)/gi;
    let ixMatch: RegExpExecArray | null;
    while ((ixMatch = createIndexRe.exec(lower)) !== null) {
      const tbl = shortName(ixMatch[1].replace(/"/g, ""));
      const cols = ixMatch[2].split(",").map((c) => c.trim().replace(/[^a-z0-9_]/g, ""));
      for (const col of cols) {
        indexedColumns.add(`${tbl}.${col}`);
      }
    }

    for (const { name: rawName, body } of tables) {
      const tableName = rawName.toLowerCase();
      const shortTable = shortName(tableName);
      const bodyLow = body.toLowerCase();

      const columns = extractColumns(body);

      // --- Check: PRIMARY KEY defined (inline or table-level) ---
      const hasPk =
        /primary\s+key/.test(bodyLow) ||
        /\bidentity\b/.test(bodyLow);

      if (!hasPk) {
        push({
          rule_id: "missing-primary-key",
          severity: "HIGH",
          table: rawName,
          message: `Table "${rawName}" has no PRIMARY KEY defined.`,
          suggestion:
            "Add a primary key, e.g. `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`.",
        });
      }

      // --- Check: audit columns ---
      const colNames = columns.map((c) => c.name.toLowerCase());
      const hasCreatedAt = colNames.includes("created_at");
      const hasUpdatedAt = colNames.includes("updated_at");

      if (!hasCreatedAt || !hasUpdatedAt) {
        const missing = [
          !hasCreatedAt ? "created_at" : null,
          !hasUpdatedAt ? "updated_at" : null,
        ]
          .filter(Boolean)
          .join(", ");
        push({
          rule_id: "missing-audit-columns",
          severity: "LOW",
          table: rawName,
          message: `Table "${rawName}" is missing audit timestamp column(s): ${missing}.`,
          suggestion:
            "Add: `created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. " +
            "For updated_at, add a trigger or use application-level updates.",
        });
      }

      // --- Per-column checks ---
      for (const col of columns) {
        const colLow = col.name.toLowerCase();
        const defLow = col.definition.toLowerCase();

        // Naming convention — must be snake_case
        if (!isSnakeCase(col.name)) {
          push({
            rule_id: "column-naming-convention",
            severity: "MEDIUM",
            table: rawName,
            column: col.name,
            message: `Column "${col.name}" on table "${rawName}" is not snake_case.`,
            suggestion: `Rename to \`${col.name
              .replace(/([A-Z])/g, "_$1")
              .replace(/^_/, "")
              .toLowerCase()}\`.`,
          });
        }

        // FK column (_id suffix) without REFERENCES and without a CREATE INDEX
        const looksLikeFkColumn =
          colLow.endsWith("_id") && colLow !== "id" && !colLow.startsWith("id");
        const hasInlineReference = /\breferences\b/.test(defLow);
        const hasTableLevelFk = new RegExp(
          `foreign\\s+key\\s*\\([^)]*\\b${colLow}\\b[^)]*\\)`,
          "i"
        ).test(bodyLow);

        // FK column covered by an index?
        const coveredByIndex =
          indexedColumns.has(`${shortTable}.${colLow}`) ||
          // inline PRIMARY KEY / UNIQUE index covers it
          /\b(primary\s+key|unique)\b/.test(defLow);

        if ((hasInlineReference || hasTableLevelFk) && !coveredByIndex) {
          push({
            rule_id: "fk-column-missing-index",
            severity: "HIGH",
            table: rawName,
            column: col.name,
            message:
              `Column "${rawName}.${col.name}" is a foreign key but has no covering index. ` +
              "Unindexed FK columns make JOINs and CASCADE operations slow.",
            suggestion: `Add: \`CREATE INDEX ON ${rawName} (${col.name});\``,
          });
        } else if (looksLikeFkColumn && !hasInlineReference && !hasTableLevelFk) {
          // Column looks like an FK but has no REFERENCES clause
          push({
            rule_id: "fk-column-missing-constraint",
            severity: "LOW",
            table: rawName,
            column: col.name,
            message:
              `Column "${rawName}.${col.name}" looks like a foreign key (ends in _id) ` +
              "but has no REFERENCES constraint.",
            suggestion:
              "If this is an FK, add a REFERENCES clause. If it is intentionally unconstrained, " +
              "document why with a COMMENT ON COLUMN.",
          });
        }

        // NOT NULL missing on non-audit, non-optional columns
        // Only warn on columns that look mandatory (id, *_id FK cols) and are nullable
        const isNullable = !(/\bnot\s+null\b/.test(defLow));
        if (
          (col.name === "id" || (looksLikeFkColumn && hasInlineReference)) &&
          isNullable &&
          !/\bdefault\b/.test(defLow)
        ) {
          push({
            rule_id: "missing-not-null",
            severity: "MEDIUM",
            table: rawName,
            column: col.name,
            message: `Column "${rawName}.${col.name}" appears mandatory but is missing NOT NULL.`,
            suggestion: "Add NOT NULL to prevent accidental NULLs.",
          });
        }

        // TIMESTAMPTZ vs TIMESTAMP — Postgres: always use TIMESTAMPTZ
        if (
          dialect === "postgresql" &&
          /\btimestamp\b/.test(defLow) &&
          !/\btimestamptz\b/.test(defLow) &&
          !/\bwith\s+time\s+zone\b/.test(defLow)
        ) {
          push({
            rule_id: "prefer-timestamptz",
            severity: "MEDIUM",
            table: rawName,
            column: col.name,
            message: `Column "${rawName}.${col.name}" uses TIMESTAMP without time zone.`,
            suggestion:
              "Use TIMESTAMPTZ (TIMESTAMP WITH TIME ZONE) to store UTC and avoid " +
              "daylight-saving ambiguity when reading data across sessions.",
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    const highCount = checks.filter((c) => c.severity === "HIGH").length;
    const mediumCount = checks.filter((c) => c.severity === "MEDIUM").length;
    const lowCount = checks.filter((c) => c.severity === "LOW").length;

    const safe = highCount === 0;

    return JSON.stringify(
      {
        safe,
        summary: {
          high: highCount,
          medium: mediumCount,
          low: lowCount,
          total: checks.length,
        },
        checks,
        note: safe
          ? "No HIGH-severity issues found. Review MEDIUM/LOW findings and address as appropriate."
          : `${highCount} HIGH-severity issue(s) must be resolved before writing DDL to the editor.`,
      },
      null,
      2
    );
  },
});
