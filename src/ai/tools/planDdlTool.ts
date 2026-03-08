// ============================================================================
// AI Agent - DDL Planning Tool
// ============================================================================
//
// plan_ddl is the DDL equivalent of plan_sql_query.
//
// It auto-detects whether the user wants to CREATE new tables or ALTER
// existing ones, then performs live introspection against the connected
// database and returns a structured plan — FK PK types for CREATE, full
// current schema state + risk guide for ALTER — that gates the DDL workflow.

import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import type { AgentContext } from "../agent";
import type { TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo, CustomTypeInfo } from "@/stores/types";

// ---------------------------------------------------------------------------
// Helpers (mirrors planTools.ts conventions)
// ---------------------------------------------------------------------------

interface TableRef {
  schema: string;
  table: string;
}

function parseTableRef(raw: string): TableRef {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot >= 0) {
    return { schema: trimmed.slice(0, dot).trim(), table: trimmed.slice(dot + 1).trim() };
  }
  return { schema: "", table: trimmed };
}

function tableKey(ref: TableRef): string {
  return `${ref.schema}.${ref.table}`;
}

function resolveConnectionId(ctx?: AgentContext, requestedConnectionId?: string): string {
  const { activeConnectionId } = useAppStore.getState();
  const id = requestedConnectionId ?? ctx?.executionContext.targetConnectionId ?? activeConnectionId;
  if (!id) throw new Error("No resolved database connection.");
  return id;
}

// Heuristic: pick the best-practice rules relevant to a DDL task
function inferDdlBestPracticeRules(
  goal: string,
  mode: "create" | "alter",
  hasMultipleTables: boolean
): string[] {
  const rules = new Set<string>(["schema-primary-keys", "schema-constraints"]);
  const lowerGoal = goal.toLowerCase();

  if (hasMultipleTables || /\b(foreign key|fk|reference|belong|join|relate)\b/.test(lowerGoal)) {
    rules.add("schema-foreign-key-indexes");
  }

  if (/\b(partition|range|hash|list partition)\b/.test(lowerGoal)) {
    rules.add("schema-partitioning");
  }

  if (mode === "alter") {
    rules.add("lock-deadlock-prevention");
    rules.add("lock-short-transactions");
  }

  if (/\b(rls|row.level.security|policy|tenant|multi.tenant|auth)\b/.test(lowerGoal)) {
    rules.add("security-rls-basics");
  }

  return Array.from(rules);
}

// ---------------------------------------------------------------------------
// plan_ddl tool
// ---------------------------------------------------------------------------

export const planDdl = tool({
  description:
    "ALWAYS call this first when writing DDL (CREATE TABLE, ALTER TABLE, migrations). " +
    "It auto-detects CREATE mode (proposed tables don't exist yet) or ALTER mode (tables already exist). " +
    "CREATE mode: validates naming conflicts, fetches PK types of referenced existing tables so FK column " +
    "types match exactly, and surfaces reusable ENUMs/custom types. " +
    "ALTER mode: fetches the full current schema state (columns, indexes, FKs) and returns an " +
    "expand-and-contract risk guide for safe migrations. " +
    "Always call get_postgres_best_practice for the returned rule IDs before drafting any DDL.",
  inputSchema: z.object({
    goal: z.string().describe("What the DDL should accomplish in plain English"),
    entities: z
      .array(z.string())
      .describe(
        "Schema-qualified table names involved. For CREATE: the new tables you plan to create. " +
          "For ALTER: the existing tables you plan to modify. Always include the schema prefix, e.g. ['public.orders']."
      ),
    references: z
      .array(z.string())
      .optional()
      .describe(
        "For CREATE mode only: schema-qualified names of EXISTING tables that the new tables will " +
          "reference via foreign keys (e.g. ['public.users', 'public.products']). " +
          "plan_ddl will fetch their primary key column names and types so you can match FK column types exactly."
      ),
    connection_id: z.string().optional().describe("Optional explicit connection ID"),
  }),

  execute: async ({ goal, entities, references, connection_id }, { experimental_context }) => {
    const ctx = experimental_context as AgentContext | undefined;
    const connectionId = resolveConnectionId(ctx, connection_id);
    const dialect = ctx?.executionContext.targetConnectionDialect ?? "unknown";

    if (entities.length === 0) {
      return JSON.stringify({ status: "error", error: "No entities provided." }, null, 2);
    }

    // --- 1. Validate all entity names are schema-qualified ---
    const parsed = entities.map(parseTableRef);
    const unqualified = parsed.filter((r) => !r.schema).map((r) => r.table);
    if (unqualified.length > 0) {
      return JSON.stringify(
        {
          status: "error",
          error:
            "Entity names must include the schema prefix (e.g. public.orders). " +
            `Missing schema for: ${unqualified.join(", ")}. ` +
            "Use list_schemas and list_tables to browse the database.",
        },
        null,
        2
      );
    }

    // --- 2. Check which entities already exist (grouped by schema to minimise IPC) ---
    const bySchema = new Map<string, TableRef[]>();
    for (const ref of parsed) {
      const list = bySchema.get(ref.schema) ?? [];
      list.push(ref);
      bySchema.set(ref.schema, list);
    }

    const existing = new Set<string>();
    const conflicts: string[] = [];
    const notFound: string[] = [];

    await Promise.all(
      Array.from(bySchema.entries()).map(async ([schema, refs]) => {
        const available = await invoke<TableInfo[]>("get_tables", { connectionId, schema });
        const availableNames = new Set(available.map((t) => t.name));
        for (const ref of refs) {
          if (availableNames.has(ref.table)) {
            existing.add(tableKey(ref));
          }
        }
      })
    );

    const allExist = parsed.every((r) => existing.has(tableKey(r)));
    const noneExist = parsed.every((r) => !existing.has(tableKey(r)));

    // Mixed: some proposed entities already exist, some don't
    if (!allExist && !noneExist) {
      for (const ref of parsed) {
        if (existing.has(tableKey(ref))) conflicts.push(tableKey(ref));
        else notFound.push(tableKey(ref));
      }
      return JSON.stringify(
        {
          status: "error",
          error:
            "Mixed entities: some already exist in the database and some don't. " +
            "For CREATE, provide only tables that do not exist yet. " +
            "For ALTER, provide only tables that already exist.",
          already_exist: conflicts,
          not_found: notFound,
          hint: "Call plan_ddl separately for CREATE and ALTER tasks.",
        },
        null,
        2
      );
    }

    const mode: "create" | "alter" = noneExist ? "create" : "alter";
    const relevantSchemas = Array.from(new Set(parsed.map((r) => r.schema)));
    const recommendedRules = inferDdlBestPracticeRules(goal, mode, parsed.length > 1 || (references?.length ?? 0) > 0);

    // =========================================================================
    // CREATE MODE
    // =========================================================================
    if (mode === "create") {
      const referencedTableKeys = new Set<string>(parsed.map(tableKey));

      // --- 3a. Check for naming conflicts with existing tables ---
      const namingConflicts: string[] = parsed
        .filter((r) => existing.has(tableKey(r)))
        .map(tableKey);

      // --- 3b. Fetch PK column info for each referenced existing table ---
      const referencedExistingTables: Array<{
        table: string;
        pk_columns: Array<{ name: string; data_type: string }>;
      }> = [];

      if (references && references.length > 0) {
        const parsedRefs = references.map(parseTableRef);
        const unqualifiedRefs = parsedRefs.filter((r) => !r.schema).map((r) => r.table);
        if (unqualifiedRefs.length > 0) {
          return JSON.stringify(
            {
              status: "error",
              error: `References must be schema-qualified. Missing schema for: ${unqualifiedRefs.join(", ")}.`,
            },
            null,
            2
          );
        }

        await Promise.all(
          parsedRefs.map(async (ref) => {
            // Verify the referenced table actually exists
            const available = await invoke<TableInfo[]>("get_tables", {
              connectionId,
              schema: ref.schema,
            });
            const exists = available.some((t) => t.name === ref.table);
            if (!exists) {
              referencedExistingTables.push({
                table: tableKey(ref),
                pk_columns: [],
              });
              return;
            }

            const columns = await invoke<ColumnInfo[]>("get_columns", {
              connectionId,
              table: ref.table,
              schema: ref.schema,
            });
            const pkColumns = columns
              .filter((c) => c.is_primary_key)
              .map((c) => ({ name: c.name, data_type: c.data_type }));

            referencedExistingTables.push({ table: tableKey(ref), pk_columns: pkColumns });
            relevantSchemas.push(ref.schema);
          })
        );
      }

      // --- 3c. Discover reusable custom types (ENUMs, domains) in relevant schemas ---
      const reusableTypes: Array<{ name: string; schema: string; type_kind: string }> = [];
      if (dialect === "postgresql") {
        const uniqueSchemas = Array.from(new Set(relevantSchemas));
        await Promise.all(
          uniqueSchemas.map(async (schema) => {
            const types = await invoke<CustomTypeInfo[]>("get_custom_types", {
              connectionId,
              schema,
            });
            for (const t of types) {
              if (!referencedTableKeys.has(`${schema}.${t.name}`)) {
                reusableTypes.push({
                  name: t.name,
                  schema: t.schema ?? schema,
                  type_kind: t.type_kind,
                });
              }
            }
          })
        );
      }

      // --- 3d. Build next steps ---
      const nextSteps: string[] = [];

      if (recommendedRules.length > 0) {
        nextSteps.push(
          `Call get_postgres_best_practice for each of: ${recommendedRules.join(", ")}`
        );
      }

      if (namingConflicts.length > 0) {
        nextSteps.push(
          `WARNING: These names already exist — choose different names: ${namingConflicts.join(", ")}`
        );
      }

      for (const ref of referencedExistingTables) {
        if (ref.pk_columns.length > 0) {
          const pkDesc = ref.pk_columns
            .map((c) => `${c.name} ${c.data_type}`)
            .join(", ");
          nextSteps.push(
            `FK to ${ref.table}: match column type to its PK (${pkDesc}). Do NOT guess the type.`
          );
        } else {
          nextSteps.push(
            `FK to ${ref.table}: table not found or has no primary key — verify with describe_table.`
          );
        }
      }

      if (reusableTypes.length > 0) {
        const enumList = reusableTypes
          .filter((t) => t.type_kind === "enum")
          .map((t) => `${t.schema}.${t.name}`)
          .join(", ");
        if (enumList) {
          nextSteps.push(
            `Reuse existing ENUM type(s) where appropriate: ${enumList}. Check if any of these fit before creating a new type.`
          );
        }
      }

      nextSteps.push(
        "Draft full CREATE TABLE DDL: use IDENTITY PK, add CREATE INDEX for every FK column, " +
          "include NOT NULL on non-optional columns, add COMMENT ON COLUMN for non-obvious columns."
      );
      nextSteps.push(
        "Call validate_ddl on the draft DDL to catch structural issues before writing to the editor."
      );
      nextSteps.push(
        "Write each CREATE TABLE into a separate cell with add_cell (requires approval)."
      );

      return JSON.stringify(
        {
          status: "ready",
          mode: "create",
          goal,
          proposed_entities: parsed.map(tableKey),
          naming_conflicts: namingConflicts,
          referenced_existing_tables: referencedExistingTables,
          reusable_types: reusableTypes,
          recommended_best_practice_rules: recommendedRules,
          next_steps: nextSteps,
        },
        null,
        2
      );
    }

    // =========================================================================
    // ALTER MODE
    // =========================================================================

    // --- 4. Fetch full current state for each table (parallel IPC) ---
    const currentState: Record<
      string,
      {
        columns: Array<{ name: string; type: string; nullable: boolean; primary_key: boolean; comment?: string }>;
        indexes: Array<{ name: string; unique: boolean; primary: boolean }>;
        foreign_keys: Array<{ constraint: string; column: string; references: string }>;
      }
    > = {};

    await Promise.all(
      parsed.map(async (ref) => {
        const [columns, indexes, foreignKeys] = await Promise.all([
          invoke<ColumnInfo[]>("get_columns", {
            connectionId,
            table: ref.table,
            schema: ref.schema,
          }),
          invoke<IndexInfo[]>("get_indexes", {
            connectionId,
            table: ref.table,
            schema: ref.schema,
          }),
          invoke<ForeignKeyInfo[]>("get_foreign_keys", {
            connectionId,
            table: ref.table,
            schema: ref.schema,
          }),
        ]);

        currentState[tableKey(ref)] = {
          columns: columns.map((c) => ({
            name: c.name,
            type: c.data_type,
            nullable: c.is_nullable,
            primary_key: c.is_primary_key,
            comment: c.comment,
          })),
          indexes: indexes.map((i) => ({
            name: i.name,
            unique: i.is_unique,
            primary: i.is_primary,
          })),
          foreign_keys: foreignKeys.map((fk) => ({
            constraint: fk.constraint_name,
            column: fk.column_name,
            references: `${fk.foreign_table_schema}.${fk.foreign_table_name}(${fk.foreign_column_name})`,
          })),
        };
      })
    );

    // --- 5. Risk classification guide (static — the LLM uses this to build migration phases) ---
    const ddlRiskGuide = {
      safe: [
        "ADD COLUMN with a DEFAULT value (non-blocking)",
        "ADD COLUMN nullable with no default (non-blocking)",
        "CREATE INDEX CONCURRENTLY (non-blocking, Postgres only)",
        "ADD CONSTRAINT … NOT VALID, then VALIDATE CONSTRAINT separately",
        "DROP INDEX CONCURRENTLY (non-blocking, Postgres only)",
        "SET DEFAULT on an existing column",
      ],
      risky: [
        "ADD NOT NULL without DEFAULT (full table rewrite / lock in older Postgres; use ADD COLUMN + backfill + set NOT NULL instead)",
        "CHANGE column type to a compatible type (e.g. int → bigint) — may require table rewrite",
        "DROP CONSTRAINT (check all dependent queries/views first)",
        "ADD FOREIGN KEY without NOT VALID (acquires ShareRowExclusiveLock for full table scan)",
      ],
      dangerous: [
        "DROP COLUMN (data loss; coordinate with app code before running phase 3 contract)",
        "RENAME COLUMN or RENAME TABLE (breaks all references in app code — use expand-and-contract: add new, backfill, drop old)",
        "CHANGE column type to an incompatible type (full table rewrite, extended lock)",
        "DROP TABLE (irreversible data loss)",
        "TRUNCATE (irreversible data loss)",
        "SET NOT NULL on a column that has existing NULLs (will fail)",
      ],
    };

    const expandContractPattern = [
      "Phase 1 — expand: add new columns/tables/indexes with safe operations. Can run on live production.",
      "Phase 2 — migrate_data: backfill data into new structures (UPDATE in batches to avoid lock contention).",
      "Phase 3 — contract: remove old columns/tables after app code has been updated. Highest lock risk.",
      "Never combine a dangerous operation with safe ones in the same transaction or migration file.",
    ].join(" ");

    // --- 6. Build next steps ---
    const nextSteps: string[] = [
      `Review current_state for each table before drafting any DDL.`,
      `Classify each intended change using ddl_risk_guide before writing DDL.`,
    ];

    if (recommendedRules.length > 0) {
      nextSteps.push(
        `Call get_postgres_best_practice for each of: ${recommendedRules.join(", ")}`
      );
    }

    nextSteps.push(
      "Draft DDL in migration phases following the expand-and-contract pattern: " +
        "Phase 1 (safe additions), Phase 2 (data backfill if needed), Phase 3 (removal of old structures).",
      "Put each phase into its own add_cell (requires approval). Never mix dangerous operations with safe ones.",
      "Call validate_ddl on each phase's DDL before writing to the editor."
    );

    return JSON.stringify(
      {
        status: "ready",
        mode: "alter",
        goal,
        tables: parsed.map(tableKey),
        current_state: currentState,
        ddl_risk_guide: ddlRiskGuide,
        expand_contract_pattern: expandContractPattern,
        recommended_best_practice_rules: recommendedRules,
        next_steps: nextSteps,
      },
      null,
      2
    );
  },
});
