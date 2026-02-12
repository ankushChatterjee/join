// ============================================================================
// AI Agent - Editor Tools (Vercel AI SDK)
// ============================================================================

import { tool } from "ai";
import { z } from "zod/v4";
import { useAppStore } from "@/stores/appStore";
import {
  getSelectedText,
  getFullEditorContent,
  getCursorPosition,
  insertTextAtCursor,
  replaceEditorContent,
} from "@/components/editor/editorUtils";

// --- get_editor_context ---
export const getEditorContext = tool({
  description:
    "Get the current state of the SQL editor including the full content, any selected text, and cursor position.",
  inputSchema: z.object({}),
  execute: async () => {
    const { openScripts, activeScriptId } = useAppStore.getState();
    const activeScript = openScripts.find((s) => s.id === activeScriptId);

    const fullContent = getFullEditorContent();
    const selectedText = getSelectedText();
    const cursorPos = getCursorPosition();

    return JSON.stringify(
      {
        scriptName: activeScript?.name || null,
        fullContent: fullContent || "",
        selectedText: selectedText || null,
        cursorPosition: cursorPos,
        isDirty: activeScript?.isDirty || false,
      },
      null,
      2
    );
  },
});

// --- insert_sql ---
export const insertSql = tool({
  description:
    "Insert SQL text into the editor at the current cursor position. Use this when you want to add SQL without replacing existing content.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL text to insert at the cursor position"),
  }),
  execute: async ({ sql }) => {
    insertTextAtCursor(sql);
    useAppStore.getState().saveOpenTabs();
    return `Successfully inserted SQL into the editor.`;
  },
});

// --- replace_editor_content ---
export const replaceEditorContentTool = tool({
  description:
    "Replace the entire content of the SQL editor. Use this when you want to completely rewrite the editor content.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL text to replace the editor content with"),
  }),
  execute: async ({ sql }) => {
    replaceEditorContent(sql);
    useAppStore.getState().saveOpenTabs();
    return `Successfully replaced editor content.`;
  },
});
