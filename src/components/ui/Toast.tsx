import { X, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type Toast as ToastType } from "@/stores/appStore";

const icons = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

const styles = {
  error: "bg-red-500/10 border-red-500/30 text-red-400",
  success: "bg-green-500/10 border-green-500/30 text-green-400",
  info: "bg-accent-500/10 border-accent-500/30 text-accent-400",
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { dismissToast } = useAppStore();
  const Icon = icons[toast.type];

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border backdrop-blur-sm shadow-lg animate-in slide-in-from-right-full duration-300",
        styles[toast.type]
      )}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        onClick={() => dismissToast(toast.id)}
        className="p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useAppStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
