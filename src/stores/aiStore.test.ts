import { beforeEach, describe, expect, it, mock } from "bun:test";

const invokeCalls: Array<{ cmd: string; payload?: Record<string, unknown> }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: Record<string, unknown>) => {
    invokeCalls.push({ cmd, payload });
    return Promise.resolve(undefined);
  },
}));

mock.module("@/ai/agent", () => ({
  runAgent: async () => undefined,
}));

const { useAiStore } = await import("./aiStore");

describe("AI chat store frontend state", () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    useAiStore.setState({
      isPanelOpen: true,
      selectedModelId: "gpt-5.4-mini",
      sessions: [],
      activeSessionId: null,
      activeSession: null,
      isStreaming: false,
      streamingTextLive: "",
      streamingTextRendered: "",
      streamingToolCalls: [],
      streamingParts: [],
      abortController: null,
      pendingApprovals: [],
      pendingQuestions: [],
      tokenUsage: 0,
      isCompacting: false,
    });
  });

  it("toggles panel visibility", () => {
    useAiStore.getState().togglePanel();
    expect(useAiStore.getState().isPanelOpen).toBe(false);
    useAiStore.getState().togglePanel();
    expect(useAiStore.getState().isPanelOpen).toBe(true);
  });

  it("persists selected model and updates the active session metadata", () => {
    useAiStore.setState({
      activeSessionId: "session-1",
      activeSession: {
        id: "session-1",
        title: "Chat",
        modelId: "gpt-5.4-mini",
        connectionId: null,
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      },
      sessions: [
        {
          id: "session-1",
          title: "Chat",
          modelId: "gpt-5.4-mini",
          connectionId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      saveActiveSession: async () => undefined,
    });

    useAiStore.getState().setSelectedModel("gpt-5.4");
    expect(useAiStore.getState().selectedModelId).toBe("gpt-5.4");
    expect(useAiStore.getState().activeSession?.modelId).toBe("gpt-5.4");
    expect(useAiStore.getState().sessions[0].modelId).toBe("gpt-5.4");
    expect(invokeCalls.some((call) => call.cmd === "set_selected_model_id")).toBe(true);
  });

  it("resolves pending approvals and questions", async () => {
    let approval: boolean | null = null;
    let answers: string[][] | null = null;
    let rejected = false;

    useAiStore.setState({
      pendingApprovals: [
        {
          toolCallId: "approval-1",
          toolName: "execute_readonly_sql",
          sql: "SELECT 1",
          resolve: (value) => {
            approval = value;
          },
        },
      ],
      pendingQuestions: [
        {
          toolCallId: "question-1",
          questions: [],
          resolve: (value) => {
            answers = value;
          },
          reject: () => {
            rejected = true;
          },
        },
      ],
    });

    useAiStore.getState().approveToolCall("approval-1", true);
    useAiStore.getState().answerQuestion("question-1", [["public"]]);
    expect(approval).toBe(true);
    expect(answers).toEqual([["public"]]);
    expect(useAiStore.getState().pendingApprovals).toEqual([]);
    expect(useAiStore.getState().pendingQuestions).toEqual([]);

    useAiStore.setState({
      pendingQuestions: [{ toolCallId: "question-2", questions: [], resolve: () => undefined, reject: () => (rejected = true) }],
    });
    useAiStore.getState().rejectQuestion("question-2");
    expect(rejected).toBe(true);
  });

  it("stops streaming, aborts active work, and rejects pending prompts", () => {
    let approved = true;
    let rejected = false;
    const controller = new AbortController();

    useAiStore.setState({
      isStreaming: true,
      streamingTextLive: "hello",
      streamingTextRendered: "hello",
      streamingParts: [{ type: "text", text: "hello", index: 0 }],
      abortController: controller,
      pendingApprovals: [{ toolCallId: "a1", toolName: "tool", sql: "SELECT 1", resolve: (value) => (approved = value) }],
      pendingQuestions: [{ toolCallId: "q1", questions: [], resolve: () => undefined, reject: () => (rejected = true) }],
    });

    useAiStore.getState().stopStreaming();
    expect(controller.signal.aborted).toBe(true);
    expect(approved).toBe(false);
    expect(rejected).toBe(true);
    expect(useAiStore.getState().isStreaming).toBe(false);
    expect(useAiStore.getState().streamingParts).toEqual([]);
  });
});
