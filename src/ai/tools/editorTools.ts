// ============================================================================
// AI Agent - Editor Tools (Vercel AI SDK)
// ============================================================================

import { tool } from "ai";
import { z } from "zod/v4";
import { useAppStore } from "@/stores/appStore";
import type { AgentContext } from "../agent";
import {
  getSelectedText,
  getFullEditorContent,
  getCursorPosition,
  getEditorView,
  insertTextAtCursor,
} from "@/components/editor/editorUtils";

// --- get_editor_context ---
export const getEditorContext = tool({
  description:
    "Get the current SQL sheet editor state including selected cell details, cell content, selected text, and cursor position.",
  inputSchema: z.object({}),
  execute: async () => {
    const { openScripts, openResultTabs, activeScriptId, activeEditorTab } = useAppStore.getState();
    const activeResultTab =
      activeEditorTab?.kind === "result"
        ? openResultTabs.find((t) => t.id === activeEditorTab.id)
        : null;
    const activeScript = openScripts.find((s) => s.id === activeScriptId);
    const selectedCell = activeScript?.cells.find(
      (cell) => cell.id === activeScript.selectedCellId
    );
    const selectedCellIndex =
      selectedCell && activeScript
        ? activeScript.cells.findIndex((cell) => cell.id === selectedCell.id) + 1
        : null;

    const fullContent = getFullEditorContent();
    const selectedText = getSelectedText();
    const cursorPos = getCursorPosition();

    if (activeResultTab) {
      return JSON.stringify(
        {
          editorMode: "result",
          resultTabName: activeResultTab.name,
          resultTabId: activeResultTab.id,
          savedResultId: activeResultTab.savedResultId,
          selectedCellId: activeResultTab.sqlCell.id,
          selectedCellNumber: 1,
          selectedCellContent: fullContent || activeResultTab.sqlCell.sql || "",
          cellCount: 1,
          cells: [
            {
              id: activeResultTab.sqlCell.id,
              number: 1,
              isSelected: true,
              sql: activeResultTab.sqlCell.sql,
            },
          ],
          selectedText: selectedText || null,
          cursorPosition: cursorPos,
          isDirty: false,
        },
        null,
        2
      );
    }

    return JSON.stringify(
      {
        editorMode: "script",
        sheetName: activeScript?.name || null,
        selectedCellId: activeScript?.selectedCellId || null,
        selectedCellNumber: selectedCellIndex,
        selectedCellContent: fullContent || "",
        cellCount: activeScript?.cells.length ?? 0,
        cells:
          activeScript?.cells.map((cell, index) => ({
            id: cell.id,
            number: index + 1,
            isSelected: cell.id === activeScript.selectedCellId,
            sql: cell.sql,
            lastRunAt: cell.last_run_at,
            lastRunDurationMs: cell.last_run_duration_ms,
            lastRunSuccessful: cell.last_run_successful,
          })) ?? [],
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
    "Insert SQL into the currently selected cell at the cursor position. This tool never edits other cells.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL text to insert at the cursor position"),
  }),
  execute: async ({ sql }) => {
    const { openScripts, openResultTabs, activeScriptId, activeEditorTab, updateScriptContent, updateResultTabSql } = useAppStore.getState();
    const activeResultTab =
      activeEditorTab?.kind === "result"
        ? openResultTabs.find((t) => t.id === activeEditorTab.id)
        : null;
    if (activeResultTab) {
      updateResultTabSql(activeResultTab.id, `${activeResultTab.sqlCell.sql}${sql}`);
      return "Inserted SQL into the result tab query cell.";
    }
    const activeScript = openScripts.find((s) => s.id === activeScriptId);
    if (!activeScript?.selectedCellId) {
      return "No cell is selected. Use add_cell to create/select a cell first.";
    }

    if (!getEditorView()) {
      const selectedCell = activeScript.cells.find(
        (cell) => cell.id === activeScript.selectedCellId
      );
      if (!selectedCell) {
        return "No selected cell found. Use add_cell to create/select a cell first.";
      }
      updateScriptContent(activeScript.id, `${selectedCell.sql}${sql}`);
      useAppStore.getState().saveOpenTabs();
      return "Inserted SQL into the selected cell.";
    }

    insertTextAtCursor(sql);
    useAppStore.getState().saveOpenTabs();
    return "Inserted SQL into the selected cell.";
  },
});

// --- replace_editor_content ---
export const replaceEditorContentTool = tool({
  description:
    "Replace only the currently selected cell content. This tool never edits other cells.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL text to replace the editor content with"),
  }),
  execute: async ({ sql }) => {
    const { activeScriptId, activeEditorTab, openResultTabs, updateScriptCellProposal, updateResultTabProposal } = useAppStore.getState();
    if (activeEditorTab?.kind === "result") {
      const activeResultTab = openResultTabs.find((t) => t.id === activeEditorTab.id);
      if (!activeResultTab) return "No active result tab found.";
      updateResultTabProposal(activeResultTab.id, sql);
      return "Proposed changes to the result tab query cell. Please review them in the diff viewer.";
    }
    if (!activeScriptId) {
      return "No active SQL sheet found.";
    }

    const activeScript = useAppStore.getState().openScripts.find((s) => s.id === activeScriptId);
    if (!activeScript?.selectedCellId) {
      return "No cell is selected. Use add_cell to create/select a cell first.";
    }

    updateScriptCellProposal(activeScriptId, activeScript.selectedCellId, sql);
    return "Proposed changes to the selected cell. Please review them in the diff viewer.";
  },
});

// --- add_cell ---
// This tool requires user approval. The approval flow is handled by awaiting
// a Promise inside execute() — the onRequestApproval callback is passed
// through the experimental_context from the streamText call.
export const addCellTool = tool({
  description:
    "Add a new SQL cell to the active sheet. Use this when  you want to create a new cell for a separate query. This requires user approval. Be sure that the user wants this query before adding it.",
  inputSchema: z.object({
    sql: z
      .string()
      .optional()
      .describe("Optional SQL content for the new cell"),
  }),
  execute: async ({ sql }, { toolCallId, experimental_context, abortSignal }) => {
    const ctx = experimental_context as AgentContext | undefined;
    
    // Request user approval before adding the cell
    if (ctx?.onRequestApproval) {
      const approved = await new Promise<boolean>((resolve) => {
        ctx.onRequestApproval!({
          toolCallId,
          toolName: "add_cell",
          sql: sql ?? "(empty cell)",
          resolve,
        });
      });

      if (abortSignal?.aborted) {
        throw new Error("Aborted");
      }

      if (!approved) {
        return "User declined to add a new cell.";
      }
    }
    
    // Get fresh state after approval
    const { openScripts, activeScriptId, addScriptCell, activeEditorTab } = useAppStore.getState();
    
    if (activeEditorTab?.kind === "result") {
      return "Result tabs only support a single query cell. Editing is allowed, but adding cells is not.";
    }
    const activeScript = openScripts.find((s) => s.id === activeScriptId);

    if (!activeScript) {
      return "No active SQL sheet is open.";
    }

    const hadSelectedCell = Boolean(activeScript.selectedCellId);
    const newCellId = await addScriptCell(activeScript.id, sql ?? "", true);
    if (!newCellId) {
      return "Failed to add a new cell.";
    }

    return hadSelectedCell
      ? "Added a new cell after the selected cell."
      : "No cell was selected, so I created and selected a new cell.";
  },
});
