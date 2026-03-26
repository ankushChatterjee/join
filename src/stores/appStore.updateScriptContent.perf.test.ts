import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock: any = vi.fn((..._args: any[]) => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let useAppStore: (typeof import("./appStore"))["useAppStore"];

beforeAll(async () => {
  ({ useAppStore } = await import("./appStore"));
});

function resetStore() {
  useAppStore.setState({
    connections: [],
    activeConnectionId: null,
    queryResults: null,
    isExecuting: false,
    queryError: null,
    queryHistory: [],
    previewSource: null,
    querySql: null,
    lastQueryContext: null,
    openScripts: [],
    activeScriptId: null,
    openResultTabs: [],
    activeEditorTab: null,
    scriptsByConnection: {},
    savedResultsByConnection: {},
    toasts: [],
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const idx = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[idx];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function makeScript(scriptId: string, cellCount: number) {
  const cells = Array.from({ length: cellCount }, (_, i) => ({
    id: `cell-${scriptId}-${i + 1}`,
    sql: `SELECT ${i + 1}`,
    last_run_at: null,
    last_run_duration_ms: null,
    last_run_successful: null,
    proposed_sql: null,
  }));

  return {
    id: scriptId,
    name: `Script ${scriptId}`,
    connectionId: "c1",
    cells,
    selectedCellId: cells[0]?.id ?? null,
    isDirty: false,
    pendingSaveRevision: 0,
    lastFlushedRevision: 0,
  };
}

function runScenario({
  scripts,
  cellsPerScript,
  edits,
}: {
  scripts: number;
  cellsPerScript: number;
  edits: number;
}) {
  const openScripts = Array.from({ length: scripts }, (_, i) => makeScript(`script-${i + 1}`, cellsPerScript));
  useAppStore.setState({
    openScripts,
    activeScriptId: "script-1",
    activeEditorTab: { kind: "script", id: "script-1" },
  });

  const warmupEdits = Math.min(200, Math.floor(edits * 0.1));
  for (let i = 0; i < warmupEdits; i += 1) {
    useAppStore.getState().updateScriptContent("script-1", `SELECT warmup_${i}`);
  }

  const timings: number[] = [];
  for (let i = 0; i < edits; i += 1) {
    const started = process.hrtime.bigint();
    useAppStore.getState().updateScriptContent("script-1", `SELECT ${i}`);
    const ended = process.hrtime.bigint();
    timings.push(Number(ended - started) / 1_000_000);
  }

  return {
    edits,
    p50: percentile(timings, 50),
    p95: percentile(timings, 95),
    avg: mean(timings),
    stddev: stddev(timings),
  };
}

describe("updateScriptContent perf harness", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "queue_script_update") return Promise.resolve({});
      if (cmd === "flush_script_updates") {
        return Promise.resolve({
          scriptId: "script-1",
          pendingRevision: null,
          lastFlushedRevision: 0,
          hasPending: false,
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("reports deterministic latency distributions for small/medium/large scripted workloads", async () => {
    const small = runScenario({ scripts: 1, cellsPerScript: 5, edits: 500 });
    const medium = runScenario({ scripts: 5, cellsPerScript: 20, edits: 2000 });
    const large = runScenario({ scripts: 10, cellsPerScript: 50, edits: 5000 });

    await useAppStore.getState().flushScriptNow("script-1");

    // Keep assertions permissive; this is a harness test for reporting.
    expect(small.p95).toBeGreaterThanOrEqual(0);
    expect(medium.p95).toBeGreaterThanOrEqual(0);
    expect(large.p95).toBeGreaterThanOrEqual(0);

    console.info(
      [
        "[PERF][updateScriptContent]",
        `small edits=${small.edits} p50=${small.p50.toFixed(4)}ms p95=${small.p95.toFixed(4)}ms avg=${small.avg.toFixed(4)}ms stddev=${small.stddev.toFixed(4)}ms`,
        `medium edits=${medium.edits} p50=${medium.p50.toFixed(4)}ms p95=${medium.p95.toFixed(4)}ms avg=${medium.avg.toFixed(4)}ms stddev=${medium.stddev.toFixed(4)}ms`,
        `large edits=${large.edits} p50=${large.p50.toFixed(4)}ms p95=${large.p95.toFixed(4)}ms avg=${large.avg.toFixed(4)}ms stddev=${large.stddev.toFixed(4)}ms`,
      ].join("\n")
    );
  });
});
