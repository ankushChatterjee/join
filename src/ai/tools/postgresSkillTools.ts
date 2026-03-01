// ============================================================================
// AI Agent - Postgres Best Practices Skill Tool
// ============================================================================
//
// On-demand fetch of Supabase Postgres best practice rules.
// The agent calls this when explain_sql shows seq scans, user asks about
// indexes/RLS/schema, or optimization guidance is needed.

import { tool } from "ai";
import { z } from "zod/v4";
import { getRule, listRuleIds } from "@/ai/skills/postgresBestPractices";
import type { AgentContext } from "../agent";

export const getPostgresBestPractice = tool({
  description:
    "Fetch a specific Postgres best practice rule by ID. Call when explain_sql shows seq scans (use query-missing-indexes), user asks about RLS/security (security-rls-basics), schema design (schema-*), or query optimization. Returns full rule with incorrect/correct SQL examples. Only applies to Postgres connections.",
  inputSchema: z.object({
    rule_id: z
      .string()
      .describe(
        "Rule ID, e.g. query-missing-indexes, schema-partial-indexes, security-rls-basics"
      ),
  }),
  execute: async (
    { rule_id },
    { experimental_context }
  ): Promise<string> => {
    const ctx = experimental_context as AgentContext | undefined;
    const dialect = ctx?.executionContext?.targetConnectionDialect ?? "unknown";

    if (dialect !== "postgresql") {
      return `Postgres best practices apply only to Postgres connections. Current dialect: ${dialect}. Available rule_ids when connected to Postgres: ${listRuleIds().join(", ")}`;
    }

    const content = getRule(rule_id);
    if (!content) {
      return `Unknown rule_id: "${rule_id}". Available: ${listRuleIds().join(", ")}`;
    }

    return content;
  },
});
