import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock: any = vi.fn((..._args: any[]) => undefined);
const runAgentMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@/ai/agent", () => ({
  runAgent: (...args: unknown[]) => runAgentMock(...args),
}));
vi.mock("@/ai/contextResolver", () => ({
  resolveAgentTarget: () => ({
    connectionId: null,
    dialect: null,
    activeEditorKind: "script",
    activeScriptId: null,
    activeResultTabId: null,
    savedResultId: null,
    resultVersion: null,
    stale: false,
    blockingReason: null,
  }),
}));

let useAiStore: (typeof import("./aiStore"))["useAiStore"];
let useAppStore: (typeof import("./appStore"))["useAppStore"];

beforeAll(async () => {
  ({ useAiStore } = await import("./aiStore"));
  ({ useAppStore } = await import("./appStore"));
});

function resetStore() {
  useAppStore.setState({
    activeProject: {
      id: "p1",
      name: "Test Project",
      rootPath: "/tmp/test-project",
      createdAt: 1,
      updatedAt: 1,
    },
  } as any);
  useAiStore.setState({
    isPanelOpen: true,
    selectedModelId: "claude-sonnet-4-5-20250929",
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
    maxTokens: 200000,
    isCompacting: false,
  });
}

describe("aiStore session management", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    runAgentMock.mockReset();
    resetStore();
  });

  describe("forkSession", () => {
    it("forks a session with copied messages and forkedFrom field", async () => {
      // Setup existing session to fork
      const originalSession = {
        id: "original-id",
        title: "Original Chat",
        modelId: "claude-sonnet",
        connectionId: "conn-123",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            timestamp: 1500,
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "Hi there!",
            timestamp: 1600,
          },
        ],
      };

      // Mock get_chat_session to return the original
      invokeMock.mockImplementation((cmd: string, _args: any) => {
        if (cmd === "get_chat_session") {
          return Promise.resolve(originalSession);
        }
        if (cmd === "save_chat_session") {
          return Promise.resolve();
        }
        return Promise.resolve();
      });

      // Setup store with the session
      useAiStore.setState({
        sessions: [
          {
            id: "original-id",
            title: "Original Chat",
            modelId: "claude-sonnet",
            connectionId: "conn-123",
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      });

      const newSessionId = await useAiStore.getState().forkSession("original-id");

      // Verify a new session ID was returned
      expect(newSessionId).toBeTruthy();
      expect(newSessionId).not.toBe("original-id");

      // Verify save_chat_session was called with forked data
      const saveCalls = invokeMock.mock.calls.filter((call: any[]) => call[0] === "save_chat_session");
      expect(saveCalls.length).toBe(1);

      const savedSession = saveCalls[0][1].session;
      expect(savedSession.title).toBe("Original Chat");
      expect(savedSession.forkedFrom).toBe("original-id");
      expect(savedSession.connectionId).toBe("conn-123");
      expect(savedSession.messages.length).toBe(2);
      expect(savedSession.messages[0].content).toBe("Hello");
      expect(savedSession.messages[1].content).toBe("Hi there!");
      // Messages should have new IDs
      expect(savedSession.messages[0].id).not.toBe("msg-1");
      expect(savedSession.messages[1].id).not.toBe("msg-2");

      // Verify the new session is now active
      const state = useAiStore.getState();
      expect(state.activeSessionId).toBe(newSessionId);
      expect(state.activeSession?.forkedFrom).toBe("original-id");
      expect(state.sessions.length).toBe(2);
    });

    it("returns empty string when source session not found", async () => {
      useAiStore.setState({
        sessions: [], // No sessions
      });

      const result = await useAiStore.getState().forkSession("non-existent");

      expect(result).toBe("");
      expect(invokeMock).not.toHaveBeenCalledWith("get_chat_session", expect.anything());
    });

    it("forks session with empty messages", async () => {
      const emptySession = {
        id: "empty-id",
        title: "Empty Chat",
        modelId: "gpt-4",
        connectionId: null,
        createdAt: 1000,
        updatedAt: 2000,
        messages: [],
      };

      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "get_chat_session") {
          return Promise.resolve(emptySession);
        }
        if (cmd === "save_chat_session") {
          return Promise.resolve();
        }
        return Promise.resolve();
      });

      useAiStore.setState({
        sessions: [
          {
            id: "empty-id",
            title: "Empty Chat",
            modelId: "gpt-4",
            connectionId: null,
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      });

      const newSessionId = await useAiStore.getState().forkSession("empty-id");

      expect(newSessionId).toBeTruthy();

      const saveCalls = invokeMock.mock.calls.filter((call: any[]) => call[0] === "save_chat_session");
      const savedSession = saveCalls[0][1].session;
      expect(savedSession.messages).toEqual([]);
      expect(savedSession.forkedFrom).toBe("empty-id");
    });

    it("forked session appears first in sessions list", async () => {
      const originalSession = {
        id: "original-id",
        title: "Original",
        modelId: "model",
        connectionId: null,
        createdAt: 1000,
        updatedAt: 2000,
        messages: [],
      };

      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "get_chat_session") {
          return Promise.resolve(originalSession);
        }
        if (cmd === "save_chat_session") {
          return Promise.resolve();
        }
        return Promise.resolve();
      });

      useAiStore.setState({
        sessions: [
          {
            id: "original-id",
            title: "Original",
            modelId: "model",
            connectionId: null,
            createdAt: 1000,
            updatedAt: 2000,
          },
          {
            id: "other-id",
            title: "Other",
            modelId: "model",
            connectionId: null,
            createdAt: 500,
            updatedAt: 1500,
          },
        ],
      });

      await useAiStore.getState().forkSession("original-id");

      const state = useAiStore.getState();
      // Forked session should be first
      expect(state.sessions[0].forkedFrom).toBe("original-id");
    });
  });

  describe("createSession", () => {
    it("creates new session without forkedFrom", async () => {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "save_chat_session") {
          return Promise.resolve();
        }
        return Promise.resolve();
      });

      const sessionId = await useAiStore.getState().createSession();

      expect(sessionId).toBeTruthy();

      const saveCalls = invokeMock.mock.calls.filter((call: any[]) => call[0] === "save_chat_session");
      const savedSession = saveCalls[0][1].session;
      expect(savedSession.forkedFrom).toBeUndefined();
      expect(savedSession.title).toBe("New Chat");
    });
  });

  describe("loadSession", () => {
    it("loads session with forkedFrom field", async () => {
      const forkedSession = {
        id: "forked-id",
        title: "Forked Session",
        modelId: "model",
        connectionId: null,
        forkedFrom: "original-id",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [],
      };

      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "get_chat_session") {
          return Promise.resolve(forkedSession);
        }
        return Promise.resolve();
      });

      await useAiStore.getState().loadSession("forked-id");

      const state = useAiStore.getState();
      expect(state.activeSession?.forkedFrom).toBe("original-id");
      expect(state.activeSession?.id).toBe("forked-id");
    });

    it("synthesizes inline parts for legacy assistant messages with tool calls", async () => {
      const legacySession = {
        id: "legacy-id",
        title: "Legacy Session",
        modelId: "model",
        connectionId: null,
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "I checked your schema.",
            toolCalls: [
              {
                id: "tool-1",
                name: "get_table_schema",
                input: { table: "users" },
                status: "completed",
                result: "{\"ok\":true}",
              },
            ],
            timestamp: 1500,
          },
        ],
      };

      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "get_chat_session") {
          return Promise.resolve(legacySession);
        }
        return Promise.resolve();
      });

      await useAiStore.getState().loadSession("legacy-id");

      const message = useAiStore.getState().activeSession?.messages[0];
      expect(message?.parts?.length).toBe(2);
      expect(message?.parts?.[0]).toMatchObject({
        type: "text",
        text: "I checked your schema.",
        index: 0,
      });
      expect(message?.parts?.[1]).toMatchObject({
        type: "tool",
        index: 1,
      });
    });
  });
});

describe("aiStore streaming regressions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    runAgentMock.mockReset();
    resetStore();
  });

  it("preserves inline text/tool ordering in final assistant message", async () => {
    const now = Date.now();
    useAiStore.setState({
      activeSessionId: "s1",
      activeSession: {
        id: "s1",
        title: "Test",
        modelId: "claude-sonnet-4-5-20250929",
        connectionId: null,
        createdAt: now,
        updatedAt: now,
        messages: [],
      },
      calculateTokenUsage: async () => {},
      saveActiveSession: async () => {},
    });

    runAgentMock.mockImplementation(
      async (
        _modelId: string,
        _history: unknown[],
        _text: string,
        _ctx: unknown,
        callbacks: any
      ) => {
        callbacks.onToken("Before tool ");
        callbacks.onToolCallStart({
          id: "tool-1",
          name: "run_query",
          input: { sql: "select 1" },
        });
        callbacks.onToken("after tool");
        callbacks.onToolCallEnd("tool-1", "ok", false);
        callbacks.onComplete({
          id: "assistant-1",
          role: "assistant",
          content: "Before tool after tool",
          timestamp: Date.now(),
        });
      }
    );

    await useAiStore.getState().sendMessage("hello");
    const messages = useAiStore.getState().activeSession?.messages ?? [];
    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.parts?.map((p: any) => p.type)).toEqual(["text", "tool", "text"]);
    expect(assistant.parts?.[0]).toMatchObject({ type: "text", text: "Before tool " });
    expect((assistant.parts?.[1] as any).toolCall.id).toBe("tool-1");
    expect(assistant.parts?.[2]).toMatchObject({ type: "text", text: "after tool" });
  });
});

describe("aiStore question handling", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
  });

  describe("pendingQuestions state", () => {
    it("starts with empty pending questions", () => {
      const state = useAiStore.getState();
      expect(state.pendingQuestions).toEqual([]);
    });

    it("answerQuestion resolves the correct pending question", async () => {
      let resolvedAnswers: string[][] | undefined;
      const pendingQuestion = {
        toolCallId: "tool-123",
        questions: [
          {
            question: "What do you prefer?",
            header: "Preference",
            options: [
              { label: "Option A", description: "First option" },
              { label: "Option B", description: "Second option" },
            ],
            multiple: false,
            custom: true,
          },
        ],
        resolve: (answers: string[][]) => {
          resolvedAnswers = answers;
        },
        reject: () => {},
      };

      useAiStore.setState({ pendingQuestions: [pendingQuestion] });

      useAiStore.getState().answerQuestion("tool-123", [["Option A"]]);

      expect(resolvedAnswers).toEqual([["Option A"]]);
      expect(useAiStore.getState().pendingQuestions).toEqual([]);
    });

    it("answerQuestion does nothing for unknown toolCallId", () => {
      const pendingQuestion = {
        toolCallId: "tool-123",
        questions: [
          {
            question: "Test?",
            header: "Test",
            options: [{ label: "Yes", description: "Yes" }],
            multiple: false,
            custom: true,
          },
        ],
        resolve: () => {},
        reject: () => {},
      };

      useAiStore.setState({ pendingQuestions: [pendingQuestion] });

      useAiStore.getState().answerQuestion("unknown-id", [["Yes"]]);

      // Should still have the pending question
      expect(useAiStore.getState().pendingQuestions.length).toBe(1);
    });

    it("rejectQuestion calls reject and removes pending question", () => {
      let wasRejected = false;
      const pendingQuestion = {
        toolCallId: "tool-123",
        questions: [
          {
            question: "Test?",
            header: "Test",
            options: [{ label: "Yes", description: "Yes" }],
            multiple: false,
            custom: true,
          },
        ],
        resolve: () => {},
        reject: () => {
          wasRejected = true;
        },
      };

      useAiStore.setState({ pendingQuestions: [pendingQuestion] });

      useAiStore.getState().rejectQuestion("tool-123");

      expect(wasRejected).toBe(true);
      expect(useAiStore.getState().pendingQuestions).toEqual([]);
    });

    it("handles multiple pending questions independently", () => {
      let resolved1: string[][] | undefined;
      let resolved2: string[][] | undefined;

      const pendingQuestion1 = {
        toolCallId: "tool-1",
        questions: [
          {
            question: "Question 1?",
            header: "Q1",
            options: [{ label: "A", description: "A" }],
            multiple: false,
            custom: true,
          },
        ],
        resolve: (answers: string[][]) => {
          resolved1 = answers;
        },
        reject: () => {},
      };

      const pendingQuestion2 = {
        toolCallId: "tool-2",
        questions: [
          {
            question: "Question 2?",
            header: "Q2",
            options: [{ label: "B", description: "B" }],
            multiple: false,
            custom: true,
          },
        ],
        resolve: (answers: string[][]) => {
          resolved2 = answers;
        },
        reject: () => {},
      };

      useAiStore.setState({
        pendingQuestions: [pendingQuestion1, pendingQuestion2],
      });

      useAiStore.getState().answerQuestion("tool-1", [["A"]]);

      expect(resolved1).toEqual([["A"]]);
      expect(resolved2).toBeUndefined();
      expect(useAiStore.getState().pendingQuestions.length).toBe(1);
      expect(useAiStore.getState().pendingQuestions[0].toolCallId).toBe("tool-2");
    });
  });

  describe("stopStreaming with pending questions", () => {
    it("rejects all pending questions on stopStreaming", () => {
      let rejected1 = false;
      let rejected2 = false;

      const mockAbortController = new AbortController();

      useAiStore.setState({
        abortController: mockAbortController,
        pendingQuestions: [
          {
            toolCallId: "tool-1",
            questions: [
              {
                question: "Q1?",
                header: "Q1",
                options: [{ label: "A", description: "A" }],
                multiple: false,
                custom: true,
              },
            ],
            resolve: () => {},
            reject: () => {
              rejected1 = true;
            },
          },
          {
            toolCallId: "tool-2",
            questions: [
              {
                question: "Q2?",
                header: "Q2",
                options: [{ label: "B", description: "B" }],
                multiple: false,
                custom: true,
              },
            ],
            resolve: () => {},
            reject: () => {
              rejected2 = true;
            },
          },
        ],
      });

      useAiStore.getState().stopStreaming();

      expect(rejected1).toBe(true);
      expect(rejected2).toBe(true);
      expect(useAiStore.getState().pendingQuestions).toEqual([]);
    });
  });
});
