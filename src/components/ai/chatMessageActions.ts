export type AddInNewCellOptions = {
  activeScriptId: string | null;
  activeEditorTab: { kind: "script" | "result"; id: string } | null;
  code: string;
  addScriptCell: (scriptId: string, sql?: string, selectNewCell?: boolean) => Promise<string | null>;
  showToast: (type: "error" | "success" | "info", message: string) => void;
};

export async function addCodeInNewCell({
  activeScriptId,
  activeEditorTab,
  code,
  addScriptCell,
  showToast,
}: AddInNewCellOptions): Promise<void> {
  if (!activeScriptId || activeEditorTab?.kind !== "script") {
    showToast("info", "Open a script tab to add this query in a new cell.");
    return;
  }

  try {
    const createdCellId = await addScriptCell(activeScriptId, code, true);
    if (createdCellId) return;
  } catch {
    // Fall through and surface the same user-facing error.
  }

  showToast("error", "Failed to add a new cell.");
}
