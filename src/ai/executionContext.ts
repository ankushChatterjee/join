import type { DatabaseType } from "@/stores/types";

export type ActiveEditorKind = "script" | "result" | "none";

export interface AgentExecutionContext {
  runId: string;
  sessionId: string;
  targetConnectionId: string | null;
  targetConnectionDialect: DatabaseType | null;
  activeEditorKind: ActiveEditorKind;
  activeScriptId: string | null;
  activeResultTabId: string | null;
  savedResultId: string | null;
  metadataVersion: number | null;
  resultVersion: number | null;
  capturedAt: number;
  metadataIsFresh: boolean;
  metadataWarning: string | null;
}

