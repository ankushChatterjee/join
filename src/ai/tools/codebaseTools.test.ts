import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock: any = vi.fn((..._args: any[]) => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let askCodex: (typeof import("./codebaseTools"))["askCodex"];
let getCodebaseQuery: (typeof import("./codebaseTools"))["getCodebaseQuery"];
let useAppStore: (typeof import("@/stores/appStore"))["useAppStore"];

beforeAll(async () => {
  ({ askCodex, getCodebaseQuery } = await import("./codebaseTools"));
  ({ useAppStore } = await import("@/stores/appStore"));
});

describe("get_codebase_query tool", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({
      activeProject: {
        id: "p1",
        name: "Project",
        rootPath: "/tmp/project",
        createdAt: 1,
        updatedAt: 1,
      },
      codebases: [
        {
          id: "codebase-1",
          name: "app",
          rootPath: "/tmp/app",
          codexThreadId: null,
          queries: [],
          isExpanded: true,
          lastIndexedAt: null,
          lastError: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      toasts: [],
    } as any);
  });

  it("returns a targeted lookup result from the connected codebase", async () => {
    invokeMock.mockResolvedValue({
      status: "match",
      query: {
        id: "query-1",
        name: "signup query",
        sql: "select * from users",
        parameterizedSql: "select * from users where id = :user_id",
        sourcePath: "queries/signup.sql",
        startLine: 1,
        endLine: 2,
        framework: null,
        confidence: "high",
        notes: null,
        detectedParameters: [{ name: "user_id" }],
      },
      matches: [],
      message: null,
    });

    const result = await (getCodebaseQuery as any).execute({
      request: "find the signup query",
      file_hint: "queries/signup.sql",
    });

    expect(invokeMock).toHaveBeenCalledWith("fetch_codebase_query", {
      projectRoot: "/tmp/project",
      codebaseId: "codebase-1",
      prompt: "find the signup query\nFile hint: queries/signup.sql",
    });

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("match");
    expect(parsed.query.name).toBe("signup query");
  });

  it("reports missing codebase cleanly", async () => {
    useAppStore.setState({ codebases: [] as any });
    const result = await (getCodebaseQuery as any).execute({
      request: "find a query",
    });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("not_connected");
  });
});

describe("ask_codex tool", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({
      activeProject: {
        id: "p1",
        name: "Project",
        rootPath: "/tmp/project",
        createdAt: 1,
        updatedAt: 1,
      },
      codebases: [
        {
          id: "codebase-1",
          name: "app",
          rootPath: "/tmp/app",
          codexThreadId: null,
          queries: [],
          isExpanded: true,
          lastIndexedAt: null,
          lastError: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      toasts: [],
    } as any);
  });

  it("returns structured implementation context from the connected codebase", async () => {
    invokeMock.mockResolvedValue({
      status: "answered",
      question: "How is the signup query used?",
      summary: "The signup flow loads the query and executes it from the auth service.",
      evidence: [
        {
          sourcePath: "src/auth/signup.ts",
          startLine: 12,
          endLine: 24,
          kind: "callsite",
          summary: "Calls the signup SQL builder before executing the query.",
        },
      ],
      relatedQueries: [
        {
          name: "signup query",
          sourcePath: "queries/signup.sql",
          confidence: "high",
          notes: null,
        },
      ],
      message: null,
    });

    const result = await (askCodex as any).execute({
      request: "How is the signup query used?",
      file_hint: "queries/signup.sql",
      sql: "select * from users where email = :email",
    });

    expect(invokeMock).toHaveBeenCalledWith("ask_codebase_context", {
      projectRoot: "/tmp/project",
      codebaseId: "codebase-1",
      prompt:
        "How is the signup query used?\n\nFile hint: queries/signup.sql\n\nSQL snippet:\nselect * from users where email = :email",
    });

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("answered");
    expect(parsed.evidence[0].kind).toBe("callsite");
  });

  it("reports missing codebase cleanly", async () => {
    useAppStore.setState({ codebases: [] as any });
    const result = await (askCodex as any).execute({
      request: "How is this query used?",
    });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("not_connected");
  });
});
