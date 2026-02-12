import { useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ConnectionDialog } from "@/components/connections/ConnectionDialog";
import { ToastContainer } from "@/components/ui/Toast";
import { useAppStore } from "@/stores/appStore";
import { useAiStore } from "@/stores/aiStore";

function App() {
  const { loadConnections, loadOpenTabs, loadQueryHistory } = useAppStore();
  const { togglePanel, loadSessions } = useAiStore();

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

  // Keyboard shortcut: Cmd+L to toggle AI panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        togglePanel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [togglePanel]);

  return (
    <>
      <MainLayout />
      <ConnectionDialog />
      <ToastContainer />
    </>
  );
}

export default App;
