/**
 * PRD 019.3 Phase 3c/3d: Live execution view at /app/strategies/:id/exec/:eid.
 * Shows xyflow DAG with real-time status (2s polling), cost overlay, Gantt timeline.
 */

import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageShell } from "@/shared/layout/PageShell";
import { SlideOverPanel } from "@/shared/layout/SlideOverPanel";
import { Button } from "@/shared/components/Button";
import { Card } from "@/shared/components/Card";
import { Badge } from "@/shared/components/Badge";
import { StatusBadge, type Status } from "@/shared/data/StatusBadge";
import { StrategyDag } from "@/domains/strategies/StrategyDag";
import { CostOverlay } from "@/domains/strategies/CostOverlay";
import {
  useExecutionStatus,
  useStrategyDag,
} from "@/domains/strategies/hooks/useExecutionStatus";
import { cn } from "@/shared/lib/cn";
import { formatCost, formatDuration } from "@/shared/lib/formatters";
import type { NodeResult } from "@/domains/strategies/lib/types";
import { ArrowLeft } from "lucide-react";

// ---- Gantt Timeline ----

interface GanttBarData {
  nodeId: string;
  status: string;
  startOffset: number;
  duration: number;
}

function buildGanttBars(
  nodeResults: Record<string, NodeResult>,
  executionStartedAt: string,
): GanttBarData[] {
  const execStart = new Date(executionStartedAt).getTime();
  const bars: GanttBarData[] = [];
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    const startOffset = result.started_at
      ? new Date(result.started_at).getTime() - execStart
      : 0;
    bars.push({
      nodeId,
      status: result.status,
      startOffset: Math.max(0, startOffset),
      duration: result.duration_ms ?? 0,
    });
  }
  return bars.sort((a, b) => a.startOffset - b.startOffset);
}

function GanttTimeline({
  nodeResults,
  executionStartedAt,
  totalDurationMs,
  onNodeClick,
}: {
  nodeResults: Record<string, NodeResult>;
  executionStartedAt: string;
  totalDurationMs: number;
  onNodeClick?: (nodeId: string) => void;
}) {
  const bars = useMemo(
    () => buildGanttBars(nodeResults, executionStartedAt),
    [nodeResults, executionStartedAt],
  );
  if (bars.length === 0) return null;
  const maxTime = totalDurationMs > 0 ? totalDurationMs : Math.max(
    ...bars.map((b) => b.startOffset + b.duration), 1,
  );
  const barColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-bio";
      case "failed":
      case "gate_failed": return "bg-error";
      case "running": return "bg-bio animate-pulse";
      case "suspended": return "bg-nebular";
      default: return "bg-txt-muted/20";
    }
  };
  return (
    <div className="mt-sp-6">
      <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">
        Gantt Timeline
      </h3>
      <div className="rounded-card border border-bdr bg-abyss p-sp-4">
        <div className="space-y-2">
          {bars.map((bar) => {
            const left = (bar.startOffset / maxTime) * 100;
            const width = Math.max((bar.duration / maxTime) * 100, 1);
            return (
              <div key={bar.nodeId} className="flex items-center gap-3">
                <button
                  onClick={() => onNodeClick?.(bar.nodeId)}
                  className="font-mono text-[0.65rem] text-txt-dim w-[120px] text-left truncate hover:text-bio transition-colors"
                  title={bar.nodeId}
                >
                  {bar.nodeId}
                </button>
                <div className="flex-1 relative h-5 bg-void rounded">
                  <div
                    className={cn("absolute top-0 h-5 rounded transition-all", barColor(bar.status))}
                    style={{ left: `${left}%`, width: `${width}%`, minWidth: "4px" }}
                    title={`${bar.nodeId}: ${formatDuration(bar.duration)}`}
                  />
                </div>
                <span className="font-mono text-[0.6rem] text-txt-muted w-[50px] text-right">
                  {bar.duration > 0 ? formatDuration(bar.duration) : "--"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 pt-2 border-t border-bdr">
          <span className="font-mono text-[0.6rem] text-txt-muted">0s</span>
          <span className="font-mono text-[0.6rem] text-txt-muted">{formatDuration(maxTime)}</span>
        </div>
      </div>
    </div>
  );
}

// ---- Node Detail Panel ----

function NodeDetailContent({ nodeId, nodeResult }: { nodeId: string; nodeResult?: NodeResult }) {
  return (
    <div className="space-y-sp-4">
      <div>
        <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Node ID</p>
        <p className="font-mono text-sm text-bio">{nodeId}</p>
      </div>
      {nodeResult && (
        <>
          <div>
            <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Status</p>
            <StatusBadge status={(nodeResult.status === "gate_failed" ? "warning" : nodeResult.status) as Status} />
          </div>
          {nodeResult.cost_usd > 0 && (
            <div>
              <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Cost</p>
              <p className="font-mono text-sm text-txt">{formatCost(nodeResult.cost_usd)}</p>
            </div>
          )}
          {nodeResult.duration_ms > 0 && (
            <div>
              <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Duration</p>
              <p className="font-mono text-sm text-txt">{formatDuration(nodeResult.duration_ms)}</p>
            </div>
          )}
          {nodeResult.retries > 0 && (
            <div>
              <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Retries</p>
              <p className="font-mono text-sm text-solar">{nodeResult.retries}</p>
            </div>
          )}
          {nodeResult.error && (
            <div>
              <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Error</p>
              <pre className="font-mono text-xs text-error bg-error-dim p-2 rounded overflow-auto max-h-40">
                {nodeResult.error}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Main ExecutionView ----

export default function ExecutionView() {
  const { eid: executionId } = useParams<{ id: string; eid: string }>();
  const navigate = useNavigate();
  const { data: dag, isLoading: dagLoading, error: dagError } = useStrategyDag(executionId ?? null);
  const { data: execution, error: execError } = useExecutionStatus(executionId ?? null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!dag || !execution) return null;
    const nodeStatuses = execution.node_statuses ?? {};
    const totalNodes = dag.nodes.length;
    const completedCount = Object.values(nodeStatuses).filter((s) => s === "completed").length;
    const failedCount = Object.values(nodeStatuses).filter(
      (s) => s === "failed" || s === "gate_failed",
    ).length;
    const now = Date.now();
    const startedAt = new Date(execution.started_at).getTime();
    const durationMs = execution.duration_ms ?? (now - startedAt);
    return { totalNodes, completedCount, failedCount, durationMs };
  }, [dag, execution]);

  const selectedNodeResult = useMemo(
    () => (selectedNodeId ? execution?.node_results?.[selectedNodeId] : undefined) ?? undefined,
    [selectedNodeId, execution],
  );

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  if (dagLoading) {
    return (
      <PageShell title="Execution" wide>
        <div className="h-96 rounded-card bg-abyss-light/50 animate-pulse border border-bdr" />
      </PageShell>
    );
  }

  if (dagError || execError) {
    return (
      <PageShell title="Execution Error" wide>
        <Card>
          <p className="text-error text-sm mb-sp-3">
            {(dagError as Error)?.message ?? (execError as Error)?.message ?? "Failed to load execution"}
          </p>
          <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate("/app/strategies")}>
            Back to Strategies
          </Button>
        </Card>
      </PageShell>
    );
  }

  if (!dag) {
    return (
      <PageShell title="No DAG Data" wide>
        <Card><p className="text-txt-dim text-sm">No DAG data available for this execution.</p></Card>
      </PageShell>
    );
  }

  const isTerminal = execution && (execution.status === "completed" || execution.status === "failed" || execution.status === "suspended");

  return (
    <PageShell
      title={dag.name}
      wide
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate("/app/strategies")}>Back</Button>
          {execution && <StatusBadge status={(execution.status === "started" ? "running" : execution.status) as Status} />}
        </div>
      }
    >
      <div className="flex items-center gap-3 mb-sp-4">
        <span className="font-mono text-xs text-bio">{dag.id}</span>
        <Badge variant="default" label={`v${dag.version}`} />
        {executionId && <span className="font-mono text-[0.65rem] text-txt-muted truncate" title={executionId}>{executionId}</span>}
        {!isTerminal && <Badge variant="bio" label="LIVE" size="sm" />}
      </div>

      <div className="relative rounded-card border border-bdr overflow-hidden" style={{ height: "500px" }}>
        <StrategyDag dag={dag} execution={execution} onNodeClick={handleNodeClick} />
        {execution && stats && (
          <CostOverlay
            status={execution.status}
            costUsd={execution.cost_usd}
            nodeCount={stats.totalNodes}
            completedCount={stats.completedCount}
            failedCount={stats.failedCount}
            durationMs={stats.durationMs}
          />
        )}
      </div>

      {execution?.node_results && Object.keys(execution.node_results).length > 0 && (
        <GanttTimeline
          nodeResults={execution.node_results}
          executionStartedAt={execution.started_at}
          totalDurationMs={stats?.durationMs ?? 0}
          onNodeClick={handleNodeClick}
        />
      )}

      {execution?.gate_results && execution.gate_results.length > 0 && (
        <div className="mt-sp-6">
          <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">Gate Results</h3>
          <div className="space-y-2">
            {execution.gate_results.map((gate) => (
              <div key={gate.gate_id} className={cn("flex items-center justify-between rounded-lg border p-sp-3", gate.passed ? "border-cyan/20 bg-cyan/5" : "border-error/20 bg-error-dim")}>
                <div>
                  <span className="font-mono text-xs text-txt">{gate.gate_id}</span>
                  <p className="font-mono text-[0.6rem] text-txt-muted mt-0.5">{gate.check}</p>
                </div>
                <Badge variant={gate.passed ? "cyan" : "error"} label={gate.passed ? "PASS" : "FAIL"} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}

      <SlideOverPanel open={selectedNodeId !== null} onClose={() => setSelectedNodeId(null)} title={selectedNodeId ?? ""} subtitle="NODE DETAIL">
        {selectedNodeId && <NodeDetailContent nodeId={selectedNodeId} nodeResult={selectedNodeResult} />}
      </SlideOverPanel>
    </PageShell>
  );
}
