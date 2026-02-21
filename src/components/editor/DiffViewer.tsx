import { useMemo, useState } from 'react';
import { diffLines, type Change } from 'diff';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DiffViewerProps {
    oldValue: string;
    newValue: string;
    onAccept: () => void;
    onReject: () => void;
}

// A "hunk" is a group of adjacent changed lines (removed + added together)
interface Hunk {
    id: number;
    context: Change[]; // unchanged context lines before/after (for display)
    removed: Change[];
    added: Change[];
    accepted: boolean | null; // null = pending, true = accepted, false = rejected
}

function buildHunks(diff: Change[]): Hunk[] {
    const hunks: Hunk[] = [];
    let hunkId = 0;
    let i = 0;

    while (i < diff.length) {
        const part = diff[i];
        if (!part.added && !part.removed) {
            i++;
            continue;
        }

        const removed: Change[] = [];
        const added: Change[] = [];

        while (i < diff.length && (diff[i].removed || diff[i].added)) {
            if (diff[i].removed) removed.push(diff[i]);
            else added.push(diff[i]);
            i++;
        }

        hunks.push({ id: hunkId++, context: [], removed, added, accepted: null });
    }

    return hunks;
}

export function DiffViewer({ oldValue, newValue, onAccept, onReject }: DiffViewerProps) {
    const rawDiff = useMemo(() => diffLines(oldValue, newValue), [oldValue, newValue]);
    const [hunks, setHunks] = useState<Hunk[]>(() => buildHunks(rawDiff));

    // Reset hunks when the diff changes
    useMemo(() => {
        setHunks(buildHunks(rawDiff));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawDiff]);

    const pending = hunks.filter((h) => h.accepted === null);
    const allResolved = pending.length === 0;

    function acceptHunk(id: number) {
        setHunks((prev) => prev.map((h) => (h.id === id ? { ...h, accepted: true } : h)));
    }

    function rejectHunk(id: number) {
        setHunks((prev) => prev.map((h) => (h.id === id ? { ...h, accepted: false } : h)));
    }

    // Build a composite diff view that respects per-hunk accept/reject state.
    // Unchanged parts of rawDiff are always shown.
    const resolvedPreview = useMemo(() => {
        if (!allResolved) return null;

        let hunkCursor = 0;
        const lines: string[] = [];

        for (const part of rawDiff) {
            if (!part.added && !part.removed) {
                lines.push(part.value);
            } else if (part.removed) {
                // Find the corresponding hunk
                const hunk = hunks[hunkCursor];
                if (hunk?.accepted === false) {
                    // Rejected: keep old removed content
                    lines.push(part.value);
                }
                // If accepted, skip removed lines (new lines will follow)
            } else if (part.added) {
                const hunk = hunks[hunkCursor];
                if (hunk?.accepted === true) {
                    lines.push(part.value);
                }
                hunkCursor++;
            }
        }

        return lines.join('');
    }, [allResolved, hunks, rawDiff]);

    // Reconstruct the hunk map for rendering the diff
    let hunkIdx = 0;

    return (
        <div className="flex flex-col border border-base-700 rounded-sm overflow-hidden bg-base-900/70">
            {/* Header */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-base-850 border-b border-base-700">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-500" />
                <span className="text-[11px] text-base-200 font-semibold uppercase tracking-[0.08em]">
                    Proposed Changes
                </span>
                <span className="ml-auto text-[11px] text-base-300">
                    {pending.length} change{pending.length !== 1 ? 's' : ''} pending
                </span>
            </div>

            {/* Diff content */}
            <div className="flex flex-col font-mono text-[12px] leading-relaxed overflow-auto max-h-[360px]">
                {rawDiff.map((part, i) => {
                    if (!part.added && !part.removed) {
                        // Context line — unchanged, always visible
                        const lines = part.value.split('\n').filter((_, idx, arr) => idx < arr.length - 1 || arr[idx] !== '');
                        return (
                            <div key={i} className="px-2.5 py-0.5 text-base-400 border-l-2 border-transparent whitespace-pre">
                                {lines.map((line, li) => (
                                    <div key={li} className="flex gap-3">
                                        <span className="w-3 select-none opacity-30 text-center"> </span>
                                        <span>{line}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    }

                    if (part.removed) {
                        const hunk = hunks[hunkIdx];
                        const isPending = hunk?.accepted === null;
                        const isAccepted = hunk?.accepted === true;
                        const isRejected = hunk?.accepted === false;
                        // We'll render the full hunk block here (removed + added + controls)
                        const currentHunkIdx = hunkIdx;
                        hunkIdx++;

                        const addedPart = rawDiff[i + 1]?.added ? rawDiff[i + 1] : null;

                        return (
                            <div
                                key={i}
                                className={cn(
                                    "border-l-2 transition-all",
                                    isPending ? "border-accent-500/60 bg-base-850/70" :
                                        isAccepted ? "border-success/60 bg-success/5" :
                                            "border-base-600 bg-base-900 opacity-70"
                                )}
                            >
                                {/* Removed lines */}
                                {part.value.split('\n').filter((_, li, arr) => li < arr.length - 1 || arr[li] !== '').map((line, li) => (
                                    <div key={li} className="flex gap-3 px-2.5 py-0.5 whitespace-pre text-error/75">
                                        <span className="w-3 select-none text-center font-bold opacity-60">−</span>
                                        <span className="opacity-70">{line}</span>
                                    </div>
                                ))}
                                {/* Added lines */}
                                {addedPart && addedPart.value.split('\n').filter((_, li, arr) => li < arr.length - 1 || arr[li] !== '').map((line, li) => (
                                    <div key={li} className="flex gap-3 px-2.5 py-0.5 whitespace-pre text-success/80">
                                        <span className="w-3 select-none text-center font-bold opacity-70">+</span>
                                        <span>{line}</span>
                                    </div>
                                ))}
                                {/* Per-hunk controls */}
                                {isPending && (
                                    <div className="flex items-center justify-end gap-1.5 px-2.5 py-1 border-t border-base-700/70 bg-base-850">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); rejectHunk(currentHunkIdx); }}
                                            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-medium text-base-200 hover:bg-base-700 hover:text-base-50 transition-colors-fast"
                                        >
                                            <X className="w-3 h-3" />
                                            Deny
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); acceptHunk(currentHunkIdx); }}
                                            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-semibold bg-accent-500/20 text-accent-100 hover:bg-accent-500/30 border border-accent-500/40 transition-colors-fast"
                                        >
                                            <Check className="w-3 h-3" />
                                            Accept
                                        </button>
                                    </div>
                                )}
                                {(isAccepted || isRejected) && (
                                    <div className="flex items-center justify-end gap-1.5 px-2.5 py-1 border-t border-base-700/40">
                                        <span className={cn("text-[11px] font-semibold uppercase tracking-wider", isAccepted ? "text-success/80" : "text-base-300")}>
                                            {isAccepted ? "Accepted" : "Denied"}
                                        </span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setHunks(prev => prev.map(h => h.id === currentHunkIdx ? { ...h, accepted: null } : h)); }}
                                            className="text-[11px] text-base-300 hover:text-base-100 underline transition-colors"
                                        >
                                            undo
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    }

                    // Skip standalone `added` parts (they were already rendered inside the removed block above)
                    if (part.added && i > 0 && rawDiff[i - 1]?.removed) {
                        return null;
                    }

                    // Standalone added block (no preceding removed)
                    if (part.added) {
                        const currentHunkIdx = hunkIdx;
                        const hunk = hunks[hunkIdx];
                        const isPending = hunk?.accepted === null;
                        const isAccepted = hunk?.accepted === true;
                        hunkIdx++;

                        return (
                            <div
                                key={i}
                                className={cn(
                                    "border-l-2 transition-all",
                                    isPending ? "border-accent-500/60 bg-base-850/70" :
                                        isAccepted ? "border-success/60 bg-success/5" :
                                            "border-base-600 opacity-45"
                                )}
                            >
                                {part.value.split('\n').filter((_, li, arr) => li < arr.length - 1 || arr[li] !== '').map((line, li) => (
                                    <div key={li} className="flex gap-3 px-2.5 py-0.5 whitespace-pre text-success/80">
                                        <span className="w-3 select-none text-center font-bold opacity-70">+</span>
                                        <span>{line}</span>
                                    </div>
                                ))}
                                {isPending && (
                                    <div className="flex items-center justify-end gap-1.5 px-2.5 py-1 border-t border-base-700/70 bg-base-850">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); rejectHunk(currentHunkIdx); }}
                                            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-medium text-base-200 hover:bg-base-700 hover:text-base-50 transition-colors-fast"
                                        >
                                            <X className="w-3 h-3" /> Deny
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); acceptHunk(currentHunkIdx); }}
                                            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-semibold bg-accent-500/20 text-accent-100 hover:bg-accent-500/30 border border-accent-500/40 transition-colors-fast"
                                        >
                                            <Check className="w-3 h-3" /> Accept
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    }

                    return null;
                })}
            </div>

            {/* Footer — global accept/reject all or finalize */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-base-850 border-t border-base-700">
                {!allResolved ? (
                    <>
                        <button
                            onClick={(e) => { e.stopPropagation(); setHunks(prev => prev.map(h => ({ ...h, accepted: false }))); }}
                            className="text-[11px] text-base-300 hover:text-base-100 transition-colors-fast"
                        >
                            Deny all
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setHunks(prev => prev.map(h => ({ ...h, accepted: true }))); }}
                            className="text-[11px] text-base-300 hover:text-base-100 transition-colors-fast"
                        >
                            Accept all
                        </button>
                        <span className="ml-auto text-[11px] text-base-400 italic">Review each change above</span>
                    </>
                ) : (
                    <>
                        <span className="text-[11px] text-base-200">All changes reviewed</span>
                        <div className="ml-auto flex gap-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); onReject(); }}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px] font-medium text-base-200 hover:bg-base-700 hover:text-base-50 transition-colors-fast"
                            >
                                <X className="w-3.5 h-3.5" />
                                Discard all
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // If all accepted apply; if some denied, accept the whole proposal forcing the accumulated state.
                                    // For simplicity, we pass the resolved preview through onAccept, but our accept
                                    // currently replaces with the full proposed. We just call the parent accept.
                                    onAccept();
                                }}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-semibold bg-accent-500/20 text-accent-100 hover:bg-accent-500/30 border border-accent-500/40 transition-colors-fast"
                            >
                                <Check className="w-3.5 h-3.5" />
                                Apply
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Hidden resolved preview — for debugging */}
            {resolvedPreview !== null && (
                <div className="hidden">{resolvedPreview}</div>
            )}
        </div>
    );
}
