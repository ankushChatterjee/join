import { useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ConnectionDialog } from "@/components/connections/ConnectionDialog";
import { QueryParametersDialog } from "@/components/query/QueryParametersDialog";
import { ToastContainer } from "@/components/ui/Toast";
import { PerfOverlay } from "@/components/ui/PerfOverlay";
import { useAppStore } from "@/stores/appStore";
import { useAiStore } from "@/stores/aiStore";
import { useShallow } from "zustand/react/shallow";

function App() {
  const { loadConnections, loadOpenTabs, loadQueryHistory } = useAppStore(
    useShallow((state) => ({
      loadConnections: state.loadConnections,
      loadOpenTabs: state.loadOpenTabs,
      loadQueryHistory: state.loadQueryHistory,
    }))
  );
  const { loadSessions } = useAiStore(
    useShallow((state) => ({
      loadSessions: state.loadSessions,
    }))
  );

  useEffect(() => {
    // Load connections, open tabs, and query history on app start
    const initApp = async () => {
      await loadConnections();
      await loadOpenTabs();
      await loadQueryHistory();
    };
    initApp();
    // Load AI chat sessions
    loadSessions();
  }, [loadConnections, loadOpenTabs, loadQueryHistory, loadSessions]);

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
      <MainLayout />
      <ConnectionDialog />
      <QueryParametersDialog />
      <ToastContainer />
      <PerfOverlay />
    </>
  );
}

export default App;
