import { describe, expect, it } from "bun:test";
import { getPerfStats, recordPerfSample } from "./perf";

describe("performance sample aggregation", () => {
  it("ignores invalid samples and reports p50/p95 for practical UI timings", () => {
    const name = `test.metric.${Date.now()}`;
    recordPerfSample(name, -1);
    recordPerfSample(name, Number.NaN);
    recordPerfSample(name, 10);
    recordPerfSample(name, 20);
    recordPerfSample(name, 30);

    const stats = getPerfStats().find((entry) => entry.name === name);
    expect(stats).toEqual({ name, count: 3, p50: 20, p95: 30 });
  });

  it("caps retained samples to the most recent window", () => {
    const name = `test.window.${Date.now()}`;
    for (let i = 0; i < 250; i += 1) {
      recordPerfSample(name, i);
    }

    const stats = getPerfStats().find((entry) => entry.name === name);
    expect(stats?.count).toBe(200);
    expect(stats?.p50).toBeGreaterThanOrEqual(149);
    expect(stats?.p95).toBeGreaterThanOrEqual(239);
  });
});
