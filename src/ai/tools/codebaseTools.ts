import { tool } from "ai";
import { z } from "zod/v4";
import { useAppStore } from "@/stores/appStore";

export const getCodebaseQuery = tool({
  description:
    "Ask Codex to find a single best-matching SQL query inside the connected local folder. Use this when the user asks for a query from the codebase or when application code context is needed. Returns one match, an ambiguity set, or a not_found result.",
  inputSchema: z.object({
    request: z
      .string()
      .min(1)
      .describe("Natural-language description of the query you want to find in the connected folder."),
    file_hint: z
      .string()
      .optional()
      .describe("Optional filename or path hint if the user mentioned one."),
    name_hint: z
      .string()
      .optional()
      .describe("Optional query name hint if the user mentioned one."),
  }),
  execute: async ({ request, file_hint, name_hint }) => {
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
