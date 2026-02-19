import { cn } from "@/lib/utils";

interface ContextUsageIndicatorProps {
    usage: number; // 0 to 1
    maxTokens: number;
    currentTokens: number;
    isCompacting: boolean;
    className?: string;
}

export function ContextUsageIndicator({
    usage,
    maxTokens,
    currentTokens,
    isCompacting,
    className,
}: ContextUsageIndicatorProps) {
    const radius = 8; // Reduced radius
    const stroke = 2; // Reduced stroke
    const normalizedRadius = radius - stroke / 2;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = circumference - usage * circumference;

    // Color logic based on usage
    let colorClass = "text-accent-400";
    if (usage > 0.75) colorClass = "text-yellow-400";
    if (usage > 0.9) colorClass = "text-red-400";

    return (
        <div
            className={cn("group relative flex items-center justify-center", className)}
            title={`${currentTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens${isCompacting ? " (Compacting...)" : ""}`}
        >
            <div className="relative h-5 w-5"> {/* Reduced size */}
                <svg
                    height={radius * 2}
                    width={radius * 2}
                    className="rotate-[-90deg]"
                >
                    <circle
                        stroke="currentColor"
                        fill="transparent"
                        strokeWidth={stroke}
                        strokeDasharray={circumference + " " + circumference}
                        style={{ strokeDashoffset }}
                        r={normalizedRadius}
                        cx={radius}
                        cy={radius}
                        className={cn("transition-all duration-300 ease-in-out", colorClass)}
                    />
                    <circle
                        stroke="currentColor"
                        fill="transparent"
                        strokeWidth={stroke}
                        strokeDasharray={circumference + " " + circumference}
                        style={{ strokeDashoffset: 0 }}
                        r={normalizedRadius}
                        cx={radius}
                        cy={radius}
                        className="text-base-700/30 -z-10"
                    />
                </svg>
            </div>
            {isCompacting && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-base-800 px-2 py-1 text-[10px] text-base-200 shadow-lg animate-pulse">
                    Summarizing...
                </span>
            )}
        </div>
    );
}
