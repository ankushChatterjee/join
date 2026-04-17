import { tool } from "ai";
import { z } from "zod/v4";
import { useAppStore } from "@/stores/appStore";

export const getCodebaseQuery = tool({
  description:
    "Ask Codex to find a specific SQL query inside the connected local folder. Use this when the user asks for app/codebase SQL by feature, table, endpoint, file, or query intent. Returns one match with citations, an ambiguity set, or a not_found result.",
  inputSchema: z.object({
    request: z
      .string()
      .min(1)
      .describe("Natural-language description of the query you want to find in the connected folder."),
    table_hint: z
      .string()
      .optional()
      .describe("Optional table name hint if the user mentioned one."),
    feature_hint: z
      .string()
      .optional()
      .describe("Optional product feature, route, endpoint, or workflow hint."),
    file_hint: z
      .string()
      .optional()
      .describe("Optional filename or path hint if the user mentioned one."),
    name_hint: z
      .string()
      .optional()
      .describe("Optional query name hint if the user mentioned one."),
  }),
  execute: async ({ request, table_hint, feature_hint, file_hint, name_hint }) => {
    const state = useAppStore.getState();
    const codebase = state.codebases[0];

    if (!codebase) {
      return JSON.stringify(
        {
          status: "not_connected",
          message: "No local folder is connected to this project.",
        },
        null,
        2
      );
    }

    const promptParts = [request.trim()];
    if (table_hint?.trim()) {
      promptParts.push(`Table hint: ${table_hint.trim()}`);
    }
    if (feature_hint?.trim()) {
      promptParts.push(`Feature/endpoint hint: ${feature_hint.trim()}`);
    }
    if (file_hint?.trim()) {
      promptParts.push(`File hint: ${file_hint.trim()}`);
    }
    if (name_hint?.trim()) {
      promptParts.push(`Query name hint: ${name_hint.trim()}`);
    }

    const result = await state.fetchCodebaseQuery(codebase.id, promptParts.join("\n"));
    return JSON.stringify(
      {
        codebase: {
          id: codebase.id,
          name: codebase.name,
          rootPath: codebase.rootPath,
        },
        ...result,
      },
      null,
      2
    );
  },
});

export const askCodex = tool({
  description:
    "Ask Codex for codebase implementation context around a SQL query or data flow. Use this when you need to understand how a query is used in the app, where it is called from, which features depend on it, or how SQL moves through the codebase.",
  inputSchema: z.object({
    request: z
      .string()
      .min(1)
      .describe("The implementation/context question to ask Codex about the connected folder."),
    sql: z
      .string()
      .optional()
      .describe("Optional SQL text to help Codex identify the relevant query or usage path."),
    file_hint: z
      .string()
      .optional()
      .describe("Optional filename or path hint if the user mentioned one."),
    name_hint: z
      .string()
      .optional()
      .describe("Optional query name or feature hint."),
  }),
  execute: async ({ request, sql, file_hint, name_hint }) => {
    const state = useAppStore.getState();
    const codebase = state.codebases[0];

    if (!codebase) {
      return JSON.stringify(
        {
          status: "not_connected",
          message: "No local folder is connected to this project.",
        },
        null,
        2
      );
    }

    const promptParts = [request.trim()];
    if (name_hint?.trim()) {
      promptParts.push(`Name hint: ${name_hint.trim()}`);
    }
    if (file_hint?.trim()) {
      promptParts.push(`File hint: ${file_hint.trim()}`);
    }
    if (sql?.trim()) {
      promptParts.push(`SQL snippet:\n${sql.trim()}`);
    }

    const result = await state.askCodebaseContext(codebase.id, promptParts.join("\n\n"));
    return JSON.stringify(
      {
        codebase: {
          id: codebase.id,
          name: codebase.name,
          rootPath: codebase.rootPath,
        },
        ...result,
      },
      null,
      2
    );
  },
});
