import { useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ConnectionDialog } from "@/components/connections/ConnectionDialog";
import { QueryParametersDialog } from "@/components/query/QueryParametersDialog";
import { ToastContainer } from "@/components/ui/Toast";
import { PerfOverlay } from "@/components/ui/PerfOverlay";
import { ProjectWelcomeScreen } from "@/components/project/ProjectWelcomeScreen";
import { useAppStore } from "@/stores/appStore";
import { useAiStore } from "@/stores/aiStore";
import { useShallow } from "zustand/react/shallow";

function App() {
  const { activeProject } = useAppStore(
    useShallow((state) => ({
      activeProject: state.activeProject,
    }))
  );
  const { loadSessions, resetProjectState } = useAiStore(
    useShallow((state) => ({
      loadSessions: state.loadSessions,
      resetProjectState: state.resetProjectState,
    }))
  );

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
      {activeProject ? <MainLayout /> : <ProjectWelcomeScreen />}
      <ConnectionDialog />
      <QueryParametersDialog />
      <ToastContainer />
      <PerfOverlay />
    </>
  );
}

export default App;
