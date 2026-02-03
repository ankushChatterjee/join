import { useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ConnectionDialog } from "@/components/connections/ConnectionDialog";
import { ToastContainer } from "@/components/ui/Toast";
import { useAppStore } from "@/stores/appStore";

function App() {
  const { loadConnections, loadOpenTabs } = useAppStore();

  useEffect(() => {
    // Load connections and open tabs on app start
    const initApp = async () => {
      await loadConnections();
      await loadOpenTabs();
    };
    initApp();
  }, [loadConnections, loadOpenTabs]);

  return (
    <>
      <MainLayout />
      <ConnectionDialog />
      <ToastContainer />
    </>
  );
}

export default App;
