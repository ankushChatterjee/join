import { useEffect, useState } from "react";
import { getPerfStats } from "@/lib/perf";

export function PerfOverlay() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [rows, setRows] = useState<Array<{ name: string; count: number; p50: number; p95: number }>>([]);

  useEffect(() => {
    const enabled = window.localStorage.getItem("join:perf-overlay") === "1";
    setIsEnabled(enabled);
    if (!enabled) return;

    const timer = setInterval(() => {
      setRows(getPerfStats());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!isEnabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-[200] max-w-[420px] border border-base-700 bg-base-900/95 p-2 text-[11px] text-base-200">
      <div className="mb-1 font-semibold text-base-100">Perf Overlay</div>
      {rows.length === 0 ? (
        <div className="text-base-300">No samples yet</div>
      ) : (
        rows.map((row) => (
          <div key={row.name} className="font-mono">
            {row.name}: p50 {row.p50.toFixed(1)}ms · p95 {row.p95.toFixed(1)}ms · n={row.count}
          </div>
        ))
      )}
    </div>
  );
}

