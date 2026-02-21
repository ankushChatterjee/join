import { X, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type Toast as ToastType } from "@/stores/appStore";

const icons = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

const styles = {
  error: "bg-red-500/10 border-red-400/35 text-red-200",
  success: "bg-green-500/10 border-green-400/35 text-green-200",
  info: "bg-accent-500/12 border-accent-500/35 text-accent-200",
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { dismissToast } = useAppStore();
  const Icon = icons[toast.type];

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 p-3 rounded-sm border shadow-lg animate-in slide-in-from-right-full duration-300",
        styles[toast.type]
      )}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <p className="flex-1 text-sm leading-5">{toast.message}</p>
      <button
        onClick={() => dismissToast(toast.id)}
        className="p-0.5 rounded-sm text-current/90 hover:text-current hover:bg-white/15 transition-colors-fast cursor-pointer"
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
    <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-1.5 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
