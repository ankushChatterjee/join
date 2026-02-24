import { useAppStore } from "@/stores/appStore";
import type { DatabaseType } from "@/stores/types";

export interface ResolvedAgentTarget {
  connectionId: string | null;
  dialect: DatabaseType | null;
  metadataVersion: number | null;
  activeEditorKind: "script" | "result" | "none";
  activeScriptId: string | null;
  activeResultTabId: string | null;
  savedResultId: string | null;
  resultVersion: number | null;
  stale: boolean;
  blockingReason: string | null;
}

export function resolveAgentTarget(sessionConnectionId: string | null): ResolvedAgentTarget {
  const state = useAppStore.getState();

  const activeResultTab =
    state.activeEditorTab?.kind === "result"
      ? state.openResultTabs.find((t) => t.id === state.activeEditorTab?.id) ?? null
      : null;
  const activeScript =
    state.activeEditorTab?.kind === "script"
      ? state.openScripts.find((s) => s.id === state.activeEditorTab?.id) ?? null
      : state.openScripts.find((s) => s.id === state.activeScriptId) ?? null;

  const connectionId =
    state.activeConnectionId ??
    activeResultTab?.connectionId ??
    activeScript?.connectionId ??
    sessionConnectionId ??
    null;

  const connection = connectionId
    ? state.connections.find((c) => c.id === connectionId) ?? null
    : null;

  if (!connectionId) {
    return {
      connectionId: null,
      dialect: null,
      metadataVersion: null,
      activeEditorKind: activeResultTab ? "result" : activeScript ? "script" : "none",
      activeScriptId: activeScript?.id ?? null,
      activeResultTabId: activeResultTab?.id ?? null,
      savedResultId: activeResultTab?.savedResultId ?? null,
      resultVersion: activeResultTab?.version ?? null,
      stale: true,
      blockingReason: "No connection could be resolved from result tab, script tab, session, or active connection.",
    };
  }

  const metadataVersion = state.getConnectionMetadataVersion(connectionId);
  const hasMetadata = metadataVersion > 0;
  const connected = Boolean(connection?.is_connected);

  return {
    connectionId,
    dialect: connection?.db_type ?? null,
    metadataVersion: hasMetadata ? metadataVersion : null,
    activeEditorKind: activeResultTab ? "result" : activeScript ? "script" : "none",
    activeScriptId: activeScript?.id ?? null,
    activeResultTabId: activeResultTab?.id ?? null,
    savedResultId: activeResultTab?.savedResultId ?? null,
    resultVersion: activeResultTab?.version ?? null,
    stale: !connected || !hasMetadata,
    blockingReason: !connected
      ? `Connection ${connectionId} is not connected`
      : !hasMetadata
        ? `Metadata for connection ${connectionId} has not been loaded yet`
        : null,
  };
}
