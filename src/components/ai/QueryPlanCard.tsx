import { memo, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Database,
  Layers3,
  ScanSearch,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ExplainPlanNode,
  ExplainPlanPresentation,
  QueryPlanAnnotation,
} from "@/ai/types";

type AttributeVisibility = {
  cost: boolean;
  rows: boolean;
  names: boolean;
  warnings: boolean;
};

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 }).format(
    value
  );
}

function formatDialect(value: string): string {
  if (value === "postgresql") return "Postgres";
  if (value === "mysql") return "MySQL";
  return "SQLite";
}

function severityTone(severity: QueryPlanAnnotation["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-red-500/30 bg-red-500/8 text-red-200";
    case "warning":
      return "border-amber-500/25 bg-amber-500/8 text-amber-100";
    default:
      return "border-sky-500/20 bg-sky-500/8 text-sky-100";
  }
}

function InsightChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center border border-base-700/80 bg-base-900/70 px-2 py-1 text-[11px] text-base-200">
      {label}
    </span>
  );
}

function PlanNodePreview({
  node,
  presentation,
}: {
  node: ExplainPlanNode;
  presentation: ExplainPlanPresentation;
}) {
  const annotation = presentation.annotations.find((item) => item.node_id === node.node_id);
  return (
    <div className="relative pl-4">
      <div className="absolute bottom-0 left-0 top-0 w-px bg-base-800" />
      <div className="absolute left-0 top-3 h-px w-3 bg-base-800" />
      <div className="border border-base-700/70 bg-base-900/65 px-2.5 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-base-100">{node.label}</p>
            <p className="mt-0.5 text-[11px] text-base-300">
              {node.index_name
                ? `Uses ${node.index_name}`
                : node.relation_name
                  ? `Touches ${node.relation_name}`
                  : node.node_type}
            </p>
          </div>
          {annotation && (
            <span
              className={cn(
                "shrink-0 border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]",
                severityTone(annotation.severity)
              )}
            >
              {annotation.severity}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function QueryPlanTree({
  presentation,
  selectedNodeId,
  onSelect,
  visibility,
  maxPreviewNodes,
}: {
  presentation: ExplainPlanPresentation;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  visibility: AttributeVisibility;
  maxPreviewNodes?: number;
}) {
  const { plan } = presentation;
  const visibleIds = maxPreviewNodes
    ? new Set(plan.normalized_plan.ordered_node_ids.slice(0, maxPreviewNodes))
    : null;

  const renderNode = (nodeId: string) => {
    const node = plan.normalized_plan.nodes[nodeId];
    if (!node) return null;
    if (visibleIds && !visibleIds.has(nodeId)) return null;
    const annotationCount = presentation.annotations.filter((item) => item.node_id === nodeId).length;

    return (
      <div key={nodeId} className="pl-4">
        <button
          type="button"
          onClick={() => onSelect(nodeId)}
          className={cn(
            "group relative w-full border border-base-800/90 px-3 py-2 text-left transition-colors-fast",
            selectedNodeId === nodeId
              ? "bg-accent-500/12 text-base-50"
              : "bg-base-900/45 text-base-200 hover:bg-base-850"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium">{node.label}</p>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-base-300">
                {visibility.names && node.relation_name && <span>{node.relation_name}</span>}
                {visibility.names && node.index_name && <span>{node.index_name}</span>}
                {visibility.cost && node.metrics.total_cost != null && (
                  <span>cost {formatNumber(node.metrics.total_cost)}</span>
                )}
                {visibility.rows && node.metrics.plan_rows != null && (
                  <span>rows {formatNumber(node.metrics.plan_rows)}</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {visibility.warnings && node.warnings.length > 0 && (
                <span className="inline-flex items-center gap-1 border border-amber-500/25 bg-amber-500/8 px-1.5 py-0.5 text-[10px] text-amber-100">
                  <TriangleAlert className="h-3 w-3" />
                  {node.warnings.length}
                </span>
              )}
              {annotationCount > 0 && (
                <span className="inline-flex items-center border border-sky-500/20 bg-sky-500/8 px-1.5 py-0.5 text-[10px] text-sky-100">
                  {annotationCount} notes
                </span>
              )}
            </div>
          </div>
        </button>
        {node.child_node_ids.length > 0 && (
          <div className="mt-2 space-y-2 border-l border-base-800/70 pl-3">
            {node.child_node_ids.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  if (!plan.normalized_plan.root_node_id) {
    return (
      <div className="border border-base-800 bg-base-900/45 px-3 py-3 text-[12px] text-base-300">
        Raw EXPLAIN output is available, but the plan tree could not be normalized.
      </div>
    );
  }

  return <div className="space-y-2">{renderNode(plan.normalized_plan.root_node_id)}</div>;
}

function QueryPlanInspector({
  presentation,
  selectedNodeId,
}: {
  presentation: ExplainPlanPresentation;
  selectedNodeId: string | null;
}) {
  const node =
    (selectedNodeId && presentation.plan.normalized_plan.nodes[selectedNodeId]) ||
    (presentation.plan.normalized_plan.root_node_id
      ? presentation.plan.normalized_plan.nodes[presentation.plan.normalized_plan.root_node_id]
      : null);
  const annotations = presentation.annotations.filter((item) => item.node_id === node?.node_id);

  if (!node) {
    return (
      <div className="border border-base-800 bg-base-900/45 px-4 py-4 text-[12px] text-base-300">
        Select a node to inspect its details.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-base-800 bg-base-900/55 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.08em] text-base-400">Selected node</p>
        <h3 className="mt-1 text-[16px] font-semibold text-base-50">{node.label}</h3>
        {(node.description || node.node_type) && (
          <p className="mt-1 text-[12px] text-base-300">{node.description ?? node.node_type}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div className="border border-base-800 bg-base-900/45 px-3 py-2">
          <p className="text-base-400">Estimated cost</p>
          <p className="mt-1 text-base-100">{formatNumber(node.metrics.total_cost)}</p>
        </div>
        <div className="border border-base-800 bg-base-900/45 px-3 py-2">
          <p className="text-base-400">Planned rows</p>
          <p className="mt-1 text-base-100">{formatNumber(node.metrics.plan_rows)}</p>
        </div>
        <div className="border border-base-800 bg-base-900/45 px-3 py-2">
          <p className="text-base-400">Relation</p>
          <p className="mt-1 text-base-100">{node.relation_name ?? "n/a"}</p>
        </div>
        <div className="border border-base-800 bg-base-900/45 px-3 py-2">
          <p className="text-base-400">Index</p>
          <p className="mt-1 text-base-100">{node.index_name ?? "n/a"}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.08em] text-base-400">Agent notes</p>
        {annotations.length > 0 ? (
          annotations.map((annotation) => (
            <div
              key={annotation.annotation_id}
              className={cn("border px-3 py-2 text-[12px]", severityTone(annotation.severity))}
            >
              <p className="font-medium">{annotation.title}</p>
              <p className="mt-1 leading-5">{annotation.explanation}</p>
              {annotation.recommendation && (
                <p className="mt-2 text-[11px] text-base-200">
                  Recommendation: {annotation.recommendation}
                </p>
              )}
            </div>
          ))
        ) : (
          <div className="border border-base-800 bg-base-900/45 px-3 py-2 text-[12px] text-base-300">
            No targeted annotation for this node.
          </div>
        )}
      </div>

      {node.warnings.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-base-400">Warnings</p>
          {node.warnings.map((warning, index) => (
            <div
              key={`${node.node_id}-warning-${index}`}
              className="border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[12px] text-amber-100"
            >
              {warning}
            </div>
          ))}
        </div>
      )}

      <details className="border border-base-800 bg-base-900/45 px-3 py-2 text-[12px] text-base-200">
        <summary className="cursor-pointer select-none text-base-100">Raw plan</summary>
        <pre className="panel-scroll mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-base-300">
          {JSON.stringify(presentation.plan.raw_plan, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function QueryPlanModal({
  presentation,
  selectedNodeId,
  onClose,
  onSelect,
}: {
  presentation: ExplainPlanPresentation;
  selectedNodeId: string | null;
  onClose: () => void;
  onSelect: (nodeId: string) => void;
}) {
  const [visibility, setVisibility] = useState<AttributeVisibility>({
    cost: true,
    rows: true,
    names: true,
    warnings: true,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/72 p-6 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-[1240px] flex-col border border-base-700 bg-base-950 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4 border-b border-base-800 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.08em] text-base-400">
              {formatDialect(presentation.plan.dialect)} plan viewer
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-base-50">{presentation.title}</h2>
            <p className="mt-1 text-[13px] text-base-300">{presentation.summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-base-700 bg-base-900/60 p-2 text-base-300 transition-colors-fast hover:bg-base-850 hover:text-base-100"
            aria-label="Close query plan viewer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-base-800 px-5 py-3 text-[12px] text-base-300">
          {(["cost", "rows", "names", "warnings"] as const).map((key) => (
            <label
              key={key}
              className="inline-flex items-center gap-2 border border-base-700/80 bg-base-900/60 px-2 py-1"
            >
              <input
                type="checkbox"
                checked={visibility[key]}
                onChange={(event) =>
                  setVisibility((current) => ({ ...current, [key]: event.target.checked }))
                }
              />
              <span className="capitalize">{key}</span>
            </label>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.3fr)_minmax(340px,0.9fr)] gap-0">
          <div className="panel-scroll overflow-auto border-r border-base-800 px-5 py-4">
            <QueryPlanTree
              presentation={presentation}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              visibility={visibility}
            />
          </div>
          <div className="panel-scroll overflow-auto px-5 py-4">
            <QueryPlanInspector presentation={presentation} selectedNodeId={selectedNodeId} />
          </div>
        </div>
      </div>
    </div>
  );
}

export const QueryPlanCard = memo(function QueryPlanCard({
  presentation,
}: {
  presentation: ExplainPlanPresentation;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    presentation.default_focus_node_id ?? presentation.plan.normalized_plan.root_node_id
  );

  const previewNodes = useMemo(() => {
    const ids = presentation.plan.normalized_plan.ordered_node_ids.slice(0, 3);
    return ids
      .map((id) => presentation.plan.normalized_plan.nodes[id])
      .filter((node): node is ExplainPlanNode => Boolean(node));
  }, [presentation]);

  const chips = useMemo(() => {
    const result: string[] = [
      formatDialect(presentation.plan.dialect),
      presentation.plan.safe_to_proceed ? "ready to proceed" : "needs review",
    ];
    if (presentation.plan.estimated_cost != null) {
      result.push(`cost ${formatNumber(presentation.plan.estimated_cost)}`);
    }
    if (presentation.plan.summary.indexesUsed.length > 0) {
      result.push(`${presentation.plan.summary.indexesUsed.length} index hit${presentation.plan.summary.indexesUsed.length > 1 ? "s" : ""}`);
    }
    if (presentation.plan.summary.warnings.length > 0) {
      result.push(`${presentation.plan.summary.warnings.length} warning${presentation.plan.summary.warnings.length > 1 ? "s" : ""}`);
    }
    return result.slice(0, 4);
  }, [presentation]);

  return (
    <>
      <div className="my-3 overflow-hidden border border-base-700 bg-[linear-gradient(180deg,rgba(19,19,19,0.96),rgba(10,10,10,0.96))] shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
        <div className="border-b border-base-800 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ScanSearch className="h-4 w-4 text-accent-400" />
                <p className="text-[13px] font-medium text-base-50">{presentation.title}</p>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-base-300">{presentation.summary}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="inline-flex shrink-0 items-center gap-1 border border-base-700 bg-base-900/65 px-2.5 py-1 text-[11px] text-base-100 transition-colors-fast hover:bg-base-850"
            >
              Expand
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <InsightChip key={chip} label={chip} />
            ))}
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="border-b border-base-800 px-3 py-3 md:border-b-0 md:border-r">
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-base-400">
              <Layers3 className="h-3.5 w-3.5" />
              Plan preview
            </div>
            <div className="space-y-2">
              {previewNodes.length > 0 ? (
                previewNodes.map((node) => (
                  <PlanNodePreview
                    key={node.node_id}
                    node={node}
                    presentation={presentation}
                  />
                ))
              ) : (
                <div className="border border-base-800 bg-base-900/45 px-3 py-3 text-[12px] text-base-300">
                  No normalized plan nodes available. Expand to inspect the raw output.
                </div>
              )}
            </div>
          </div>

          <div className="px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-base-400">
              <Database className="h-3.5 w-3.5" />
              Notes
            </div>
            <div className="space-y-2">
              {presentation.annotations.slice(0, 2).map((annotation) => (
                <button
                  key={annotation.annotation_id}
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(annotation.node_id);
                    setIsExpanded(true);
                  }}
                  className={cn(
                    "w-full border px-3 py-2 text-left text-[12px] transition-colors-fast hover:bg-base-850/80",
                    severityTone(annotation.severity)
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{annotation.title}</span>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  </div>
                  <p className="mt-1 leading-5">{annotation.explanation}</p>
                </button>
              ))}
              {presentation.annotations.length === 0 && (
                <div className="border border-base-800 bg-base-900/45 px-3 py-2 text-[12px] text-base-300">
                  The plan is available to inspect, but the agent did not add targeted notes for this one.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <QueryPlanModal
          presentation={presentation}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
          onClose={() => setIsExpanded(false)}
        />
      )}
    </>
  );
});
