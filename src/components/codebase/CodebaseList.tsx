import { open } from "@tauri-apps/plugin-dialog";
import { ChevronRight, Folder, Plus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/stores/appStore";
import { cn } from "@/lib/utils";

interface CodebaseListProps {
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

export function CodebaseList({ isExpanded, onToggleExpanded }: CodebaseListProps) {
  const { codebases, isLoadingCodebases, connectCodebase, disconnectCodebase } = useAppStore(
    useShallow((state) => ({
      codebases: state.codebases,
      isLoadingCodebases: state.isLoadingCodebases,
      connectCodebase: state.connectCodebase,
      disconnectCodebase: state.disconnectCodebase,
    }))
  );

  const codebase = codebases[0];

  const handleConnect = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Connect a local folder",
    });
    if (!selected || typeof selected !== "string") return;
    await connectCodebase(selected);
  };

  return (
    <div className="border-b border-base-750/60 bg-base-900/70">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={onToggleExpanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-1 py-0.5 text-left transition-colors-fast hover:bg-base-850/60"
          title={isExpanded ? "Collapse codebase" : "Expand codebase"}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-base-300 transition-transform duration-150",
              isExpanded && "rotate-90"
            )}
          />
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent-300" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-base-100">
            Codebase
          </span>
          {codebase ? (
            <span className="ml-0.5 truncate text-[12px] text-base-300">
              [{codebase.name}]
            </span>
          ) : null}
        </button>
        {codebase ? (
          <button
            onClick={() => disconnectCodebase(codebase.id)}
            disabled={isLoadingCodebases}
            className="ghost-button -mr-1 rounded-sm p-1 text-base-300 transition-colors-fast hover:text-red-300 disabled:opacity-40"
            title="Disconnect folder"
            aria-label="Disconnect folder"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={isLoadingCodebases}
            className="ghost-button -mr-1 rounded-sm p-1 transition-colors-fast disabled:opacity-40"
            aria-label="Connect folder"
            title="Connect folder"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isExpanded ? (
        <div className="px-5 pb-3">
          {codebase ? (
            <>
              <div className="truncate text-[12px] font-semibold text-base-100">{codebase.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-base-300">
                {codebase.rootPath}
              </div>
              <div className="mt-1 text-[11px] text-base-300">
                Ask chat to find SQL from this folder and open it in a sheet.
              </div>
              {codebase.lastError ? (
                <div className="mt-2 rounded-sm border border-red-500/30 bg-red-500/8 px-2 py-1 text-[11px] text-red-200">
                  {codebase.lastError}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-[12px] text-base-300">
              {isLoadingCodebases
                ? "Connecting folder..."
                : "Connect a local folder so chat can find app SQL by request."}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
