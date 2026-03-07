// ============================================================================
// Postgres Best Practices Skill Tool - Tests
// ============================================================================
//
// Verifies get_postgres_best_practice tool behavior for different dialects
// and rule_id inputs.

import { describe, expect, it } from "vitest";
import { getPostgresBestPractice } from "./postgresSkillTools";
import { listRuleIds } from "@/ai/skills/postgresBestPractices";

function agentContext(dialect: string) {
  return {
    executionContext: {
      runId: "run-1",
      sessionId: "session-1",
      targetConnectionId: "c1",
      targetConnectionDialect: dialect,
      activeEditorKind: "script",
      activeScriptId: null,
      activeResultTabId: null,
      savedResultId: null,
      metadataVersion: null,
      resultVersion: null,
      capturedAt: Date.now(),
      metadataIsFresh: true,
      metadataWarning: null,
    },
  };
}

describe("get_postgres_best_practice tool", () => {
  describe("input schema", () => {
    it("requires rule_id", () => {
      const schema = (getPostgresBestPractice as any).inputSchema;
      expect(schema.safeParse({ rule_id: "query-missing-indexes" }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ rule_id: "" }).success).toBe(true); // empty string is valid input, tool will return unknown
    });
  });

  describe("execute - Postgres dialect", () => {
    it("returns full rule content for valid rule_id", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "query-missing-indexes" },
        { experimental_context: agentContext("postgresql") }
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("Add Indexes on WHERE and JOIN Columns");
      expect(result).toContain("```sql");
      expect(result).toContain("create index");
      expect(result).toContain("Seq Scan");
    });

    it("returns full rule content for security-rls-basics", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "security-rls-basics" },
        { experimental_context: agentContext("postgresql") }
      );

      expect(result).toContain("Row Level Security");
      expect(result).toMatch(/create policy|enable row level security/i);
    });

    it("returns full rule content for schema-foreign-key-indexes", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "schema-foreign-key-indexes" },
        { experimental_context: agentContext("postgresql") }
      );

      expect(result).toContain("Index Foreign Key Columns");
      expect(result).toContain("foreign key");
    });

    it("returns unknown rule message with available list for invalid rule_id", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "nonexistent-rule-xyz" },
        { experimental_context: agentContext("postgresql") }
      );

      expect(result).toContain('Unknown rule_id: "nonexistent-rule-xyz"');
      expect(result).toContain("Available:");
      expect(result).toContain("query-missing-indexes");
    });

    it("available list in unknown response matches listRuleIds", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "invalid" },
        { experimental_context: agentContext("postgresql") }
      );

      const availablePart = result.split("Available:")[1]?.trim() ?? "";
      const listedIds = availablePart.split(", ").map((s: string) => s.trim());
      const expectedIds = listRuleIds();
      expect(listedIds.sort()).toEqual(expectedIds.sort());
    });
  });

  describe("execute - non-Postgres dialects", () => {
    it("returns dialect restriction message for mysql", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "query-missing-indexes" },
        { experimental_context: agentContext("mysql") }
      );

      expect(result).toContain("Postgres best practices apply only to Postgres connections");
      expect(result).toContain("mysql");
      expect(result).not.toContain("Add Indexes on WHERE and JOIN Columns");
    });

    it("returns dialect restriction message for sqlite", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "query-missing-indexes" },
        { experimental_context: agentContext("sqlite") }
      );

      expect(result).toContain("Postgres best practices apply only to Postgres connections");
      expect(result).toContain("sqlite");
    });

    it("returns dialect restriction when dialect is unknown", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "query-missing-indexes" },
        { experimental_context: agentContext("unknown") }
      );

      expect(result).toContain("Postgres best practices apply only to Postgres connections");
      expect(result).toContain("unknown");
    });

    it("includes available rule list in dialect restriction message", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "query-missing-indexes" },
        { experimental_context: agentContext("mysql") }
      );

      expect(result).toContain("query-missing-indexes");
    });
  });

  describe("execute - missing context", () => {
    it("treats missing experimental_context as unknown dialect", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "query-missing-indexes" },
        {}
      );

      expect(result).toContain("Postgres best practices apply only to Postgres connections");
      expect(result).toContain("unknown");
    });

    it("treats missing executionContext as unknown dialect", async () => {
      const result = await (getPostgresBestPractice as any).execute(
        { rule_id: "query-missing-indexes" },
        { experimental_context: {} }
      );

      expect(result).toContain("Postgres best practices apply only to Postgres connections");
    });
  });
});
