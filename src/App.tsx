import { useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ConnectionDialog } from "@/components/connections/ConnectionDialog";
import { QueryParametersDialog } from "@/components/query/QueryParametersDialog";
import { ToastContainer } from "@/components/ui/Toast";
import { PerfOverlay } from "@/components/ui/PerfOverlay";
import { ProjectWelcomeScreen } from "@/components/project/ProjectWelcomeScreen";
import { TitleBar } from "@/components/layout/TitleBar";
import { useAppStore } from "@/stores/appStore";
import { useAiStore } from "@/stores/aiStore";
import { useShallow } from "zustand/react/shallow";

function App() {
  const { activeProject, isRestoringProject, restoreLastProject } = useAppStore(
    useShallow((state) => ({
      activeProject: state.activeProject,
      isRestoringProject: state.isRestoringProject,
      restoreLastProject: state.restoreLastProject,
    }))
  );
  const { loadSessions, resetProjectState } = useAiStore(
    useShallow((state) => ({
      loadSessions: state.loadSessions,
      resetProjectState: state.resetProjectState,
    }))
  );

  useEffect(() => {
    void restoreLastProject();
  }, [restoreLastProject]);

  useEffect(() => {
    if (activeProject) {
      loadSessions();
    } else {
      resetProjectState();
    }
  }, [activeProject, loadSessions, resetProjectState]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = useAppStore.getState();
      const active = state.activeEditorTab;
      if (active?.kind === "script") {
        void state.flushScriptNow(active.id);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <>
      {activeProject ? (
        <MainLayout />
      ) : isRestoringProject ? (
        <div className="app-texture flex h-screen w-screen flex-col bg-background text-base-100">
          <TitleBar />
          <div className="flex flex-1 items-center justify-center text-sm text-base-300">
            Opening project...
          </div>
        </div>
      ) : (
        <ProjectWelcomeScreen />
      )}
      <ConnectionDialog />
      <QueryParametersDialog />
      <ToastContainer />
      <PerfOverlay />
    </>
  );
}

export default App;
