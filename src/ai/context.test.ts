// ============================================================================
// AI Agent Context - Tests
// ============================================================================
//
// Verifies buildSystemPrompt behavior, especially Postgres Best Practices
// catalog injection based on dialect.

import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { buildSystemPrompt } from "./context";
import { getCatalog } from "./skills/postgresBestPractices";

function minimalExecutionContext(overrides: Partial<{
  targetConnectionId: string | null;
  targetConnectionDialect: string | null;
}> = {}) {
  return {
    runId: "run-1",
    sessionId: "session-1",
    targetConnectionId: "c1",
    targetConnectionDialect: "postgresql" as const,
    activeEditorKind: "script" as const,
    activeScriptId: null,
    activeResultTabId: null,
    savedResultId: null,
    metadataVersion: null,
    resultVersion: null,
    capturedAt: Date.now(),
    metadataIsFresh: true,
    metadataWarning: null,
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    useAppStore.setState({
      connections: [{ id: "c1", name: "Test", db_type: "postgresql", is_connected: true } as any],
      activeConnectionId: "c1",
      activeEditorTab: null,
      openResultTabs: [],
      openScripts: [],
      activeScriptId: null,
      expandedTables: new Set(),
      expandedViews: new Set(),
    });
  });

  describe("Postgres Best Practices catalog injection", () => {
    it("includes Postgres Best Practices section when dialect is postgresql", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext({ targetConnectionDialect: "postgresql" }));

      expect(prompt).toContain("## Postgres Best Practices (Supabase)");
      expect(prompt).toContain("get_postgres_best_practice");
      expect(prompt).toContain("query-missing-indexes");
      expect(prompt).toContain("security-rls-basics");
    });

    it("does NOT include Postgres Best Practices when dialect is mysql", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext({ targetConnectionDialect: "mysql" }));

      expect(prompt).not.toContain("## Postgres Best Practices (Supabase)");
      expect(prompt).not.toContain("get_postgres_best_practice(rule_id)");
    });

    it("does NOT include Postgres Best Practices when dialect is sqlite", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext({ targetConnectionDialect: "sqlite" }));

      expect(prompt).not.toContain("## Postgres Best Practices (Supabase)");
    });

    it("does NOT include Postgres Best Practices when executionContext is undefined", () => {
      const prompt = buildSystemPrompt(undefined);

      expect(prompt).not.toContain("## Postgres Best Practices (Supabase)");
    });

    it("does NOT include Postgres Best Practices when targetConnectionDialect is null", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext({ targetConnectionDialect: null }));

      expect(prompt).not.toContain("## Postgres Best Practices (Supabase)");
    });

    it("catalog content matches getCatalog() output", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext({ targetConnectionDialect: "postgresql" }));
      const catalog = getCatalog();

      expect(prompt).toContain(catalog);
    });
  });

  describe("Query Building Workflow - Postgres skill instructions", () => {
    it("Step 3 WRITE includes get_postgres_best_practice guidance", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext({ targetConnectionDialect: "postgresql" }));

      expect(prompt).toContain("get_postgres_best_practice");
      expect(prompt).toContain("best practices and apply them");
    });

    it("Step 4 VERIFY includes get_postgres_best_practice and query-missing-indexes", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext({ targetConnectionDialect: "postgresql" }));

      expect(prompt).toContain("safe_to_proceed");
      expect(prompt).toContain("query-missing-indexes");
      expect(prompt).toContain("sequential scans");
    });
  });

  describe("core prompt structure", () => {
    it("includes role and workflow sections", () => {
      const prompt = buildSystemPrompt(minimalExecutionContext());

      expect(prompt).toContain("SQL expert assistant");
      expect(prompt).toContain("Join");
      expect(prompt).toContain("## Query Building Workflow");
      expect(prompt).toContain("Step 1 — PLAN");
      expect(prompt).toContain("Step 2 — FETCH");
      expect(prompt).toContain("Step 3 — WRITE");
      expect(prompt).toContain("Step 4 — VERIFY");
      expect(prompt).toContain("## Instructions");
    });
  });
});
