import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: () => undefined,
}));

const { useAppStore } = await import("@/stores/appStore");
const { resolveAgentTarget } = await import("./contextResolver");

describe("agent context resolver", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeConnectionId: null,
      connections: [],
      metadataByConnection: {},
      openScripts: [],
      activeScriptId: null,
      openResultTabs: [],
      activeEditorTab: null,
    });
  });

  it("reports a blocking reason when no connection can be resolved", () => {
    const target = resolveAgentTarget(null);
    expect(target.connectionId).toBeNull();
    expect(target.stale).toBe(true);
    expect(target.blockingReason).toContain("No connection");
  });

  it("resolves an active connected connection with metadata", () => {
    useAppStore.setState({
      activeConnectionId: "c1",
      connections: [
        {
          id: "c1",
          name: "Main DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          database: "join_test",
          username: "join",
          ssl_mode: "disable",
          is_connected: true,
        },
      ],
      metadataByConnection: {
        c1: {
          connectionId: "c1",
          version: 2,
          schemas: [],
          tablesBySchema: {},
          viewsBySchema: {},
          functionsBySchema: {},
          typesBySchema: {},
          columns: {},
          indexes: {},
          loadedAt: 1,
        },
      },
    });

    const target = resolveAgentTarget(null);
    expect(target.connectionId).toBe("c1");
    expect(target.dialect).toBe("postgresql");
    expect(target.metadataVersion).toBe(2);
    expect(target.stale).toBe(false);
  });

  it("prefers an active result tab context when present", () => {
    useAppStore.setState({
      connections: [
        {
          id: "c1",
          name: "Main DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          database: "join_test",
          username: "join",
          ssl_mode: "disable",
          is_connected: true,
        },
      ],
      metadataByConnection: {
        c1: {
          connectionId: "c1",
          version: 1,
          schemas: [],
          tablesBySchema: {},
          viewsBySchema: {},
          functionsBySchema: {},
          typesBySchema: {},
          columns: {},
          indexes: {},
          loadedAt: 1,
        },
      },
      openResultTabs: [
        {
          id: "r1",
          name: "Result",
          connectionId: "c1",
          sqlCell: { id: "cell-1", sql: "SELECT 1", proposed_sql: null },
          queryResults: null,
          lastExecutedAt: null,
          lastExecutedDatabase: null,
          previewSource: null,
          resultSource: "live",
          savedResultId: "saved-1",
          isQueryCollapsed: false,
          isStale: false,
          isDirty: false,
          version: 7,
          createdAt: 1,
        },
      ],
      activeEditorTab: { kind: "result", id: "r1" },
    });

    const target = resolveAgentTarget(null);
    expect(target.activeEditorKind).toBe("result");
    expect(target.activeResultTabId).toBe("r1");
    expect(target.savedResultId).toBe("saved-1");
    expect(target.resultVersion).toBe(7);
  });
});
