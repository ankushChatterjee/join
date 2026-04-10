import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FolderPlus } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { TitleBar } from "@/components/layout/TitleBar";
import joinLogo from "../../../src-tauri/icons/128x128.png";

function formatProjectPath(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

export function ProjectWelcomeScreen() {
  const { createProject, openProject, recentProjects } = useAppStore();
  const [name, setName] = useState("My Project");
  const [isBusy, setIsBusy] = useState(false);

  const handleCreate = async () => {
    const parentDir = await open({
      directory: true,
      multiple: false,
      title: "Choose a parent folder for the new project",
    });
    if (!parentDir || typeof parentDir !== "string") return;

    try {
      setIsBusy(true);
      await createProject(parentDir, name.trim() || "My Project");
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpen = async () => {
    const projectDir = await open({
      directory: true,
      multiple: false,
      title: "Open an existing Join project",
    });
    if (!projectDir || typeof projectDir !== "string") return;

    try {
      setIsBusy(true);
      await openProject(projectDir);
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenRecent = async (rootPath: string) => {
    try {
      setIsBusy(true);
      await openProject(rootPath);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="app-texture flex h-screen w-screen flex-col bg-background text-base-100">
      <TitleBar />
      <div className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6">
        <section className="w-full max-w-2xl rounded-lg border border-base-750 bg-base-900/88 px-7 py-8 shadow-[0_10px_30px_rgba(0,0,0,0.14)]">
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <img
              src={joinLogo}
              alt="Join"
              className="mb-6 h-20 w-20 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.16)]"
            />

            <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-base-300">
              Join Project
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-base-50">
              Start in one workspace
            </h1>

            <div className="mt-7 w-full rounded-md border border-base-750 bg-base-950/55 p-4 text-left">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.1em] text-base-300">
                Project Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 w-full rounded-sm border border-base-700 bg-base-900 px-3 text-sm text-base-100 outline-none transition-colors-fast focus:border-accent-500"
                placeholder="My Project"
              />
              <p className="mt-2 text-[12px] text-base-400">
                You’ll choose where to create the folder in the next step.
              </p>
            </div>

            <button
              onClick={handleCreate}
              disabled={isBusy}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-accent-500/40 bg-accent-500/12 px-4 text-sm font-medium text-base-100 transition-colors-fast hover:bg-accent-500/18 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FolderPlus className="h-4 w-4 text-accent-300" />
              <span>Create Project</span>
            </button>

            <button
              onClick={handleOpen}
              disabled={isBusy}
              className="mt-4 inline-flex items-center gap-2 text-[13px] text-base-300 transition-colors-fast hover:text-base-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FolderOpen className="h-4 w-4" />
              <span>Open existing project</span>
            </button>

            {recentProjects.length > 0 ? (
              <div className="mt-7 w-full border-t border-base-750 pt-5 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-base-300">
                  Recent Projects
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {recentProjects.map((project) => (
                    <button
                      key={project.rootPath}
                      onClick={() => handleOpenRecent(project.rootPath)}
                      disabled={isBusy}
                      className="flex min-h-14 w-full items-center gap-3 rounded-md border border-base-750 bg-base-950/45 px-3 py-2 text-left transition-colors-fast hover:border-base-600 hover:bg-base-850/70 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-accent-300" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-base-100">
                          {project.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-base-400">
                          {formatProjectPath(project.rootPath)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
