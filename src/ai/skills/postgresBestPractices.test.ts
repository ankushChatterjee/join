// ============================================================================
// Postgres Best Practices Skill - Tests
// ============================================================================
//
// Verifies that all markdown rules load correctly and the skill module
// functions (getRule, getCatalog, listRuleIds, getRulesByCategory) work as expected.

import { describe, expect, it } from "vitest";
import {
  getRule,
  getCatalog,
  listRuleIds,
  getRulesByCategory,
} from "./postgresBestPractices";

// All rule IDs that should be loaded from references/*.md
const EXPECTED_RULE_IDS = [
  "query-missing-indexes",
  "query-composite-indexes",
  "query-covering-indexes",
  "query-index-types",
  "query-partial-indexes",
  "data-n-plus-one",
  "data-batch-inserts",
  "data-pagination",
  "schema-foreign-key-indexes",
  "schema-partitioning",
  "schema-primary-keys",
  "schema-constraints",
  "security-rls-basics",
  "security-rls-performance",
  "security-privileges",
  "conn-pooling",
  "conn-limits",
  "lock-deadlock-prevention",
  "lock-short-transactions",
  "monitor-explain-analyze",
  "advanced-jsonb-indexing",
] as const;

describe("postgresBestPractices skill module", () => {
  describe("listRuleIds", () => {
    it("returns all expected rule IDs", () => {
      const ids = listRuleIds();
      expect(ids).toHaveLength(EXPECTED_RULE_IDS.length);
      expect(ids.sort()).toEqual([...EXPECTED_RULE_IDS].sort());
    });

    it("returns unique rule IDs", () => {
      const ids = listRuleIds();
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });

  describe("getRule - markdown loading", () => {
    it("returns null for unknown rule_id", () => {
      expect(getRule("nonexistent-rule")).toBeNull();
      expect(getRule("")).toBeNull();
      expect(getRule("query-")).toBeNull();
    });

    it("returns non-null for every known rule_id", () => {
      for (const ruleId of EXPECTED_RULE_IDS) {
        const content = getRule(ruleId);
        expect(content, `Rule ${ruleId} should load`).not.toBeNull();
        expect(typeof content).toBe("string");
      }
    });

    it("each rule has minimum expected length", () => {
      for (const ruleId of EXPECTED_RULE_IDS) {
        const content = getRule(ruleId)!;
        expect(content.length, `Rule ${ruleId} should have substantial content`).toBeGreaterThan(100);
      }
    });

    it("each rule contains YAML frontmatter with title", () => {
      for (const ruleId of EXPECTED_RULE_IDS) {
        const content = getRule(ruleId)!;
        expect(content, `Rule ${ruleId} should have frontmatter`).toMatch(/^---\s*\n/);
        expect(content, `Rule ${ruleId} should have title`).toMatch(/title:\s*.+/m);
      }
    });

    it("each rule contains markdown heading (## )", () => {
      for (const ruleId of EXPECTED_RULE_IDS) {
        const content = getRule(ruleId)!;
        expect(content, `Rule ${ruleId} should have ## heading`).toMatch(/^##\s+.+/m);
      }
    });

    it("each rule contains SQL code block", () => {
      for (const ruleId of EXPECTED_RULE_IDS) {
        const content = getRule(ruleId)!;
        expect(content, `Rule ${ruleId} should have SQL example`).toMatch(/```sql/);
      }
    });

    it("each rule contains Incorrect and Correct sections or equivalent", () => {
      for (const ruleId of EXPECTED_RULE_IDS) {
        const content = getRule(ruleId)!;
        const hasIncorrect = /Incorrect|incorrect|wrong|bad/i.test(content);
        const hasCorrect = /Correct|correct|good|proper/i.test(content);
        expect(
          hasIncorrect || hasCorrect,
          `Rule ${ruleId} should have incorrect/correct pattern`
        ).toBe(true);
      }
    });

    it("query-missing-indexes has CREATE INDEX pattern", () => {
      const content = getRule("query-missing-indexes")!;
      expect(content).toContain("create index");
      expect(content).toContain("Seq Scan");
      expect(content).toContain("Index Scan");
    });

    it("security-rls-basics has RLS policy pattern", () => {
      const content = getRule("security-rls-basics")!;
      expect(content).toMatch(/row level security|enable row level security/i);
      expect(content).toMatch(/create policy|using\s*\(/i);
    });

    it("data-n-plus-one has batch/JOIN pattern", () => {
      const content = getRule("data-n-plus-one")!;
      expect(content).toMatch(/any\s*\(|join|batch/i);
    });
  });

  describe("getCatalog", () => {
    it("returns non-empty string", () => {
      const catalog = getCatalog();
      expect(typeof catalog).toBe("string");
      expect(catalog.length).toBeGreaterThan(200);
    });

    it("contains section header", () => {
      const catalog = getCatalog();
      expect(catalog).toContain("## Postgres Best Practices (Supabase)");
    });

    it("contains get_postgres_best_practice instruction", () => {
      const catalog = getCatalog();
      expect(catalog).toContain("get_postgres_best_practice");
      expect(catalog).toContain("rule_id");
    });

    it("contains table header row", () => {
      const catalog = getCatalog();
      expect(catalog).toContain("| rule_id | description |");
      expect(catalog).toContain("|---------|-------------|");
    });

    it("contains every rule_id in the catalog", () => {
      const catalog = getCatalog();
      for (const ruleId of EXPECTED_RULE_IDS) {
        expect(catalog, `Catalog should list ${ruleId}`).toContain(ruleId);
      }
    });

    it("contains key triggers section", () => {
      const catalog = getCatalog();
      expect(catalog).toContain("Key triggers:");
      expect(catalog).toContain("query-missing-indexes");
      expect(catalog).toContain("security-rls-basics");
      expect(catalog).toContain("data-n-plus-one");
    });
  });

  describe("getRulesByCategory", () => {
    it("returns query-* rules for query prefix", () => {
      const rules = getRulesByCategory("query-");
      expect(rules.length).toBe(5);
      expect(rules.every((r) => r.id.startsWith("query-"))).toBe(true);
      expect(rules.every((r) => r.content.length > 0)).toBe(true);
    });

    it("returns schema-* rules for schema prefix", () => {
      const rules = getRulesByCategory("schema-");
      expect(rules.length).toBe(4);
      expect(rules.every((r) => r.id.startsWith("schema-"))).toBe(true);
    });

    it("returns security-* rules for security prefix", () => {
      const rules = getRulesByCategory("security-");
      expect(rules.length).toBe(3);
      expect(rules.every((r) => r.id.startsWith("security-"))).toBe(true);
    });

    it("returns empty array for non-matching prefix", () => {
      const rules = getRulesByCategory("xyz-");
      expect(rules).toEqual([]);
    });

    it("returns single rule for exact prefix match", () => {
      const rules = getRulesByCategory("query-missing-indexes");
      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe("query-missing-indexes");
    });
  });
});
