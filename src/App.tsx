import { useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ConnectionDialog } from "@/components/connections/ConnectionDialog";
import { ToastContainer } from "@/components/ui/Toast";
import { useAppStore } from "@/stores/appStore";

function App() {
  const { loadConnections, loadOpenTabs, loadQueryHistory } = useAppStore();

  useEffect(() => {
    // Load connections, open tabs, and query history on app start
    const initApp = async () => {
      await loadConnections();
      await loadOpenTabs();
      await loadQueryHistory();
    };
    initApp();
  }, [loadConnections, loadOpenTabs, loadQueryHistory]);

  return (
    <>
      <MainLayout />
      <ConnectionDialog />
      <ToastContainer />
    </>
  );
}

export default App;
