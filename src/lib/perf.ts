type PerfSampleMap = Record<string, number[]>;

const MAX_SAMPLES = 200;
const samples: PerfSampleMap = {};

export function recordPerfSample(name: string, durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const bucket = samples[name] ?? [];
  bucket.push(durationMs);
  if (bucket.length > MAX_SAMPLES) {
    bucket.splice(0, bucket.length - MAX_SAMPLES);
  }
  samples[name] = bucket;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function getPerfStats() {
  return Object.entries(samples).map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    return { name, count: values.length, p50, p95 };
  });
}

