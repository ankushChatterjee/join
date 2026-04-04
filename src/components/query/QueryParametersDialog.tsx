import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { SqlParamDefaults } from "@/stores/types";

export function QueryParametersDialog() {
  const pending = useAppStore((state) => state.pendingSqlParameterPrompt);
  const submit = useAppStore((state) => state.submitSqlParameterPrompt);
  const cancel = useAppStore((state) => state.cancelSqlParameterPrompt);

  const [namedValues, setNamedValues] = useState<Record<string, string>>({});
  const [positionalValues, setPositionalValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) {
      setNamedValues({});
      setPositionalValues([]);
      setError(null);
      return;
    }

    if (pending.spec.mode === "named" && pending.values.mode === "named") {
      const next: Record<string, string> = {};
      for (const name of pending.spec.names) {
        next[name] = pending.values.values[name] ?? "";
      }
      setNamedValues(next);
      setPositionalValues([]);
    } else if (pending.spec.mode === "positional" && pending.values.mode === "positional") {
      const existingValues = pending.values.values;
      const next = Array.from(
        { length: pending.spec.count },
        (_, index) => existingValues[index] ?? ""
      );
      setPositionalValues(next);
      setNamedValues({});
    }
    setError(null);
  }, [pending]);

  const summaryText = useMemo(() => {
    if (!pending) return "";
    if (pending.spec.mode === "named") {
      return `${pending.spec.names.length} named parameter${pending.spec.names.length === 1 ? "" : "s"}`;
    }
    return `${pending.spec.count} positional parameter${pending.spec.count === 1 ? "" : "s"}`;
  }, [pending]);

  if (!pending) return null;

  const handleRun = () => {
    if (pending.spec.mode === "named") {
      const missing = pending.spec.names.find((name) => !namedValues[name]?.trim());
      if (missing) {
        setError(`Missing value for :${missing}`);
        return;
      }
      const values: SqlParamDefaults = {
        mode: "named",
        values: Object.fromEntries(
          pending.spec.names.map((name) => [name, namedValues[name]])
        ),
      };
      submit(values);
      return;
    }

    const missingIndex = positionalValues.findIndex((value) => !value?.trim());
    if (missingIndex !== -1) {
      setError(`Missing value for parameter #${missingIndex + 1}`);
      return;
    }
    const values: SqlParamDefaults = {
      mode: "positional",
      values: positionalValues.map((value) => value),
    };
    submit(values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={cancel} />
      <div className="relative w-full max-w-lg mx-4 bg-base-900 border border-base-700 rounded-md shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-750">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-base-100">Query Parameters</h2>
            <p className="text-[11px] text-base-300 mt-0.5">{summaryText}</p>
          </div>
          <button
            onClick={cancel}
            className="p-1 rounded-sm border border-transparent hover:border-base-700 hover:bg-base-800 text-base-300 hover:text-base-100 transition-colors-fast cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-2.5 max-h-[55vh] overflow-auto panel-scroll">
          {pending.spec.mode === "named" ? (
            pending.spec.names.map((name) => (
              <div key={name}>
                <label className="block text-[12px] font-medium text-base-200 mb-1">
                  :{name}
                </label>
                <input
                  type="text"
                  value={namedValues[name] ?? ""}
                  onChange={(e) =>
                    setNamedValues((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  className="w-full h-9 px-2.5 rounded-sm bg-base-900 border border-base-700 text-[13px] text-base-100 placeholder-base-400 focus:border-accent-500 focus:outline-none transition-colors-fast"
                />
              </div>
            ))
          ) : (
            Array.from({ length: pending.spec.count }, (_, index) => (
              <div key={index}>
                <label className="block text-[12px] font-medium text-base-200 mb-1">
                  Parameter #{index + 1}
                </label>
                <input
                  type="text"
                  value={positionalValues[index] ?? ""}
                  onChange={(e) =>
                    setPositionalValues((prev) => {
                      const next = [...prev];
                      next[index] = e.target.value;
                      return next;
                    })
                  }
                  className="w-full h-9 px-2.5 rounded-sm bg-base-900 border border-base-700 text-[13px] text-base-100 placeholder-base-400 focus:border-accent-500 focus:outline-none transition-colors-fast"
                />
              </div>
            ))
          )}

          {error && <div className="text-[12px] text-red-300">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-base-750 flex items-center justify-end gap-2">
          <button
            onClick={cancel}
            className="h-8 px-3 rounded-sm border border-base-700 text-[12px] text-base-300 hover:text-base-100 hover:bg-base-800 transition-colors-fast"
          >
            Cancel
          </button>
          <button
            onClick={handleRun}
            className="h-8 px-3 rounded-sm border border-accent-500/45 text-[12px] font-semibold text-accent-300 hover:bg-accent-500/10 transition-colors-fast"
          >
            Run Query
          </button>
        </div>
      </div>
    </div>
  );
}
