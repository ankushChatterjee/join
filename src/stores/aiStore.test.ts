import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

const invokeMock: any = mock((..._args: any[]) => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let useAiStore: (typeof import("./aiStore"))["useAiStore"];

beforeAll(async () => {
  ({ useAiStore } = await import("./aiStore"));
});

function resetStore() {
  useAiStore.setState({
    isPanelOpen: true,
    selectedModelId: "claude-sonnet-4-5-20250929",
    sessions: [],
    activeSessionId: null,
    activeSession: null,
    isStreaming: false,
    streamingText: "",
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
