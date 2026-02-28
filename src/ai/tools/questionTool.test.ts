import { beforeAll, describe, expect, it } from "bun:test";

let askQuestion: (typeof import("./questionTool"))["askQuestion"];

beforeAll(async () => {
  ({ askQuestion } = await import("./questionTool"));
});

function createMockContext(answers: string[][]) {
  return {
    executionContext: {
      runId: "run-1",
      sessionId: "session-1",
      targetConnectionId: "c1",
      targetConnectionDialect: "postgresql",
      activeEditorKind: "script",
      activeScriptId: null,
      activeResultTabId: null,
      savedResultId: null,
      metadataVersion: null,
      resultVersion: null,
      capturedAt: Date.now(),
      metadataIsFresh: true,
      metadataWarning: null,
    },
    onRequestQuestion: ({ resolve }: { resolve: (answers: string[][]) => void }) => {
      resolve(answers);
    },
  };
}

describe("ask_question tool", () => {
  it("validates input schema - requires at least one question", async () => {
    const schema = (askQuestion as any).inputSchema;
    const result = schema.safeParse({ questions: [] });
    expect(result.success).toBe(false);
  });

  it("validates input schema - max 5 questions", async () => {
    const schema = (askQuestion as any).inputSchema;
    const questions = Array(6)
      .fill(null)
      .map((_, i) => ({
        question: `Question ${i}?`,
        header: `Q${i}`,
        options: [{ label: "Option A", description: "Desc" }],
      }));
    const result = schema.safeParse({ questions });
    expect(result.success).toBe(false);
  });

  it("validates input schema - max 5 options per question", async () => {
    const schema = (askQuestion as any).inputSchema;
    const options = Array(6)
      .fill(null)
      .map((_, i) => ({ label: `Option ${i}`, description: `Desc ${i}` }));
    const result = schema.safeParse({
      questions: [
        {
          question: "Test?",
          header: "Test",
          options,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("validates input schema - requires at least one option", async () => {
    const schema = (askQuestion as any).inputSchema;
    const result = schema.safeParse({
      questions: [
        {
          question: "Test?",
          header: "Test",
          options: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("validates valid input with all fields", async () => {
    const schema = (askQuestion as any).inputSchema;
    const result = schema.safeParse({
      questions: [
        {
          question: "What is your preference?",
          header: "Preference",
          options: [
            { label: "Option A", description: "First option" },
            { label: "Option B", description: "Second option" },
          ],
          multiple: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("resolves with user answers and returns formatted response", async () => {
    const answers = [["Option A", "Option B"]];
    const context = createMockContext(answers);

    const result = await (askQuestion as any).execute(
      {
        questions: [
          {
            question: "What is your preference?",
            header: "Preference",
            options: [
              { label: "Option A", description: "First option" },
              { label: "Option B", description: "Second option" },
            ],
            multiple: true,
          },
        ],
      },
      {
        toolCallId: "tool-1",
        experimental_context: context,
        abortSignal: undefined,
      }
    );

    expect(result).toContain("User answered:");
    expect(result).toContain("Option A, Option B");
  });

  it("always sets custom to true regardless of input", async () => {
    const answers = [["Custom Answer"]];
    let capturedQuestions: any = null;

    const context = {
      executionContext: {
        runId: "run-1",
        sessionId: "session-1",
        targetConnectionId: "c1",
        targetConnectionDialect: "postgresql",
        activeEditorKind: "script",
        activeScriptId: null,
        activeResultTabId: null,
        savedResultId: null,
        metadataVersion: null,
        resultVersion: null,
        capturedAt: Date.now(),
        metadataIsFresh: true,
        metadataWarning: null,
      },
      onRequestQuestion: (pending: { questions: any[]; resolve: (a: string[][]) => void }) => {
        capturedQuestions = pending.questions;
        pending.resolve(answers);
      },
    };

    await (askQuestion as any).execute(
      {
        questions: [
          {
            question: "Test question?",
            header: "Test",
            options: [{ label: "Option A", description: "Desc" }],
          },
        ],
      },
      {
        toolCallId: "tool-1",
        experimental_context: context,
        abortSignal: undefined,
      }
    );

    expect(capturedQuestions).not.toBeNull();
    expect(capturedQuestions[0].custom).toBe(true);
  });

  it("handles multiple questions with single and multi-select", async () => {
    const answers = [["Option A"], ["Option X", "Option Y"]];
    const context = createMockContext(answers);

    const result = await (askQuestion as any).execute(
      {
        questions: [
          {
            question: "Single select question?",
            header: "Single",
            options: [
              { label: "Option A", description: "A" },
              { label: "Option B", description: "B" },
            ],
            multiple: false,
          },
          {
            question: "Multi select question?",
            header: "Multi",
            options: [
              { label: "Option X", description: "X" },
              { label: "Option Y", description: "Y" },
            ],
            multiple: true,
          },
        ],
      },
      {
        toolCallId: "tool-1",
        experimental_context: context,
        abortSignal: undefined,
      }
    );

    expect(result).toContain("Option A");
    expect(result).toContain("Option X, Option Y");
  });

  it("shows unanswered for empty answers", async () => {
    const answers: string[][] = [[], []];
    const context = createMockContext(answers);

    const result = await (askQuestion as any).execute(
      {
        questions: [
          {
            question: "Question 1?",
            header: "Q1",
            options: [{ label: "Opt 1", description: "D1" }],
          },
          {
            question: "Question 2?",
            header: "Q2",
            options: [{ label: "Opt 2", description: "D2" }],
          },
        ],
      },
      {
        toolCallId: "tool-1",
        experimental_context: context,
        abortSignal: undefined,
      }
    );

    expect(result).toContain("Unanswered");
  });

  it("returns fallback when no question handler available", async () => {
    const result = await (askQuestion as any).execute(
      {
        questions: [
          {
            question: "Test?",
            header: "Test",
            options: [{ label: "Opt", description: "D" }],
          },
        ],
      },
      {
        toolCallId: "tool-1",
        experimental_context: undefined,
        abortSignal: undefined,
      }
    );

    expect(result).toBe("No question handler available.");
  });
});
