/**
 * BuildDetail — Main content area with 4 tabs: Overview, Artifacts, Events, Analytics.
 *
 * Overview: PhaseTimeline + CommissionProgress + failure cards + budget + criteria
 * Artifacts: per-phase artifact list (expandable)
 * Events: full event stream with filters
 * Analytics: cost trend, stats, failure patterns, refinements
 *
 * @see PRD 047 §Dashboard Architecture — Build Detail (tabbed)
 */

import { useState, useMemo } from 'react';
import { cn } from '@/shared/lib/cn';
import { PhaseTimeline } from './PhaseTimeline';
import { CommissionProgress } from './CommissionProgress';
import { CriteriaTracker } from './CriteriaTracker';
import { EvidenceReport } from './EvidenceReport';
import { PHASE_LABELS, PHASES } from './types';
import type { BuildSummary, BuildEvent } from './types';

// ── Tab definitions ──

type TabId = 'overview' | 'artifacts' | 'events' | 'analytics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'events', label: 'Events' },
  { id: 'analytics', label: 'Analytics' },
];

// ── Tab bar ──

function TabBar({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  return (
    <div className="flex gap-0 border-b border-bdr px-6 shrink-0 bg-abyss">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'bg-none border-none border-b-2 border-b-transparent text-txt-dim text-[13px] py-2.5 px-[18px] cursor-pointer transition-all duration-150 whitespace-nowrap',
            active === tab.id && 'text-txt border-b-[#6d5aed]',
            active !== tab.id && 'hover:text-txt',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Overview Tab ──

function OverviewTab({ build }: { build: BuildSummary }) {
  const isCompleted = build.status === 'completed';

  return (
    <div>
      {/* Phase timeline + Gantt */}
      <PhaseTimeline phases={build.phases} gantt={build.gantt} />

      {/* Evidence report for completed builds */}
      {isCompleted && build.verdict ? (
        <EvidenceReport build={build} />
      ) : (
        <>
          {/* Commission progress (only during implement) */}
          {build.commissions.length > 0 && (
            <CommissionProgress
              commissions={build.commissions}
              strategyTag="s-fcd-commission-orch"
            />
          )}

          {/* Failure recovery cards */}
          {build.failures.map((f, i) => (
            <div
              key={i}
              className="bg-[#ef444422] border border-[#ef444433] rounded-xl p-5 mb-4"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="text-[13px] font-semibold text-[#ef4444] flex items-center gap-2">
                  &#9888; Failure Recovery
                </div>
                <div className="font-mono text-[11px] text-txt-dim">{f.commissionName}</div>
              </div>
              <div className="font-mono text-xs leading-relaxed text-txt bg-void p-3 rounded-[5px] border-l-[3px] border-l-[#ef4444]">
                <span className="text-[#ef4444] font-semibold">{f.gateName}</span> failed:{' '}
                {f.description}
                <br />
                <br />
                <span className="text-[#f59e0b]">&#8635; {f.recovery}</span>
              </div>
            </div>
          ))}

          {/* Budget bar */}
          <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
            <div className="text-[13px] font-semibold text-txt mb-4">Budget</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-[#ffffff08] rounded-[4px] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#6d5aed] to-[#8b7cf7] rounded-[4px] transition-[width] duration-500"
                  style={{
                    width: `${Math.min((build.costUsd / build.budgetUsd) * 100, 100)}%`,
                  }}
                />
              </div>
              <span className="font-mono text-xs text-txt-dim w-[130px] text-right shrink-0">
                ${build.costUsd.toFixed(2)} / ${build.budgetUsd.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Two-column: criteria + recent events */}
          <div className="grid grid-cols-2 gap-4">
            <CriteriaTracker criteria={build.criteria} />

            {/* Mini event stream */}
            <div className="bg-abyss border border-bdr rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[13px] font-semibold text-txt">Recent Events</div>
                <div className="font-mono text-[11px] text-txt-dim">last 8</div>
              </div>
              <div className="font-mono text-[11px] leading-[1.8]">
                {build.events.slice(-8).map((evt, i) => (
                  <EventRow key={i} event={evt} compact />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Artifacts Tab ──

function ArtifactsTab({ build }: { build: BuildSummary }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  // Generate artifact entries for each phase
  const artifactNames: Record<string, string> = {
    explore: 'ExplorationReport',
    specify: 'FeatureSpec',
    design: 'DesignDoc',
    plan: 'realize-plan.md',
    implement: 'Code Diffs',
    review: 'Review Findings',
    validate: 'ValidationReport',
    measure: 'EvidenceReport',
  };

  return (
    <div>
      {PHASES.map((phase, idx) => {
        const phaseInfo = build.phases[idx];
        const isFuture = phaseInfo?.status === 'future';
        const isDone = phaseInfo?.status === 'completed' || phaseInfo?.status === 'recovered';
        const isCurrent = phaseInfo?.status === 'running';
        const isExpanded = expanded === idx;

        const numClasses = isDone
          ? 'bg-[#10b98122] text-[#10b981]'
          : isCurrent
            ? 'bg-[#3b82f622] text-[#3b82f6]'
            : 'bg-[#ffffff08] text-[#64748b]';

        const statusSuffix = phaseInfo?.status === 'recovered'
          ? ' (recovered)'
          : phaseInfo?.status === 'waiting'
            ? ' (awaiting)'
            : phaseInfo?.status === 'running'
              ? ' (in progress)'
              : '';

        return (
          <div key={phase}>
            <div
              className={cn(
                'bg-void border border-bdr rounded-[5px] px-4 py-3 mb-2 flex items-center gap-3 transition-all duration-150',
                !isFuture && 'cursor-pointer hover:border-[#6d5aed] hover:bg-[#0f0f18]',
                isExpanded && 'border-[#6d5aed]',
              )}
              onClick={() => !isFuture && setExpanded(isExpanded ? null : idx)}
            >
              <span
                className={cn(
                  'font-mono text-[10px] font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                  numClasses,
                )}
              >
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-txt">
                  {artifactNames[phase] ?? phase}
                </div>
                <div className="text-[10px] text-[#64748b] font-mono">
                  Phase {idx + 1} &mdash; {PHASE_LABELS[phase]}{statusSuffix}
                </div>
              </div>
              <span
                className={cn(
                  'text-[#64748b] text-xs transition-transform duration-150',
                  isFuture && 'opacity-30',
                  isExpanded && 'rotate-90',
                )}
              >
                &#9654;
              </span>
            </div>

            {/* Expanded content placeholder */}
            {isExpanded && (
              <div className="bg-[#08080e] border border-bdr border-t-0 rounded-b-[5px] p-4 mb-2 -mt-[9px] font-mono text-[11px] leading-[1.7] text-txt-dim">
                <span className="text-txt-dim italic">
                  Artifact content renders here when backend provides build artifacts.
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Events Tab ──

type EventFilter = 'all' | 'failure' | 'gate' | 'system';

function EventRow({ event, compact }: { event: BuildEvent; compact?: boolean }) {
  const typeColor =
    event.category === 'failure'
      ? 'text-[#ef4444]'
      : event.category === 'recovery'
        ? 'text-[#f59e0b]'
        : event.category === 'gate'
          ? 'text-[#f59e0b]'
          : event.category === 'system'
            ? 'text-[#64748b]'
            : 'text-[#6d5aed]';

  const detailColor =
    event.category === 'failure'
      ? 'text-[#ef4444]'
      : event.category === 'recovery'
        ? 'text-[#f59e0b]'
        : event.category === 'system'
          ? 'text-[#64748b]'
          : 'text-txt-dim';

  return (
    <div className="flex gap-3 px-2 py-[3px] rounded-[3px] hover:bg-[#ffffff06] transition-colors">
      <span className="text-[#64748b] w-[65px] shrink-0">{event.time}</span>
      {!compact && (
        <span className={cn('w-[190px] shrink-0', typeColor)}>{event.type}</span>
      )}
      {!compact && (
        <span className="text-txt w-[80px] shrink-0">{event.target}</span>
      )}
      <span className={cn('flex-1', detailColor)}>
        {compact ? `${event.type} ${event.detail}` : event.detail}
      </span>
    </div>
  );
}

function EventsTab({ build }: { build: BuildSummary }) {
  const [filter, setFilter] = useState<EventFilter>('all');

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return build.events;
    if (filter === 'failure')
      return build.events.filter(
        (e) => e.category === 'failure' || e.category === 'recovery',
      );
    return build.events.filter((e) => e.category === filter);
  }, [build.events, filter]);

  const filters: { id: EventFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'failure', label: 'Failures' },
    { id: 'gate', label: 'Gates' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-txt">Event Stream</div>
        <div className="font-mono text-[11px] text-txt-dim">{build.name}</div>
      </div>

      {/* Filter buttons */}
      <div className="flex gap-1 mb-3">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'font-mono text-[10px] px-2.5 py-[3px] rounded-full border cursor-pointer transition-all duration-150',
              filter === f.id
                ? 'bg-[#6d5aed33] text-txt border-[#6d5aed]'
                : 'bg-none text-[#64748b] border-bdr hover:text-txt hover:border-[#ffffff22]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Event rows */}
      <div className="font-mono text-[11px] leading-[1.8]">
        {filteredEvents.map((evt, i) => (
          <EventRow key={i} event={evt} />
        ))}
        {filteredEvents.length === 0 && (
          <div className="text-center text-[#64748b] py-4 text-xs">
            No events match this filter
          </div>
        )}
      </div>
    </div>
  );
}

// ── Analytics Tab (placeholder with mock sparkline) ──

function AnalyticsTab() {
  // Mock data for the cost trend sparkline
  const sparkData = [40, 65, 30, 50, 85, 45, 55, 70, 35, 41];
  const sparkLabels = ['$2.40', '$6.50', '$1.80', '$3.20', '$8.90', '$2.80', '$3.50', '$5.40', '$2.10', '$6.20'];

  return (
    <div>
      {/* Cost Trend Sparkline */}
      <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[13px] font-semibold text-txt">Cost Trend</div>
          <div className="font-mono text-[11px] text-txt-dim">last 10 builds</div>
        </div>
        <div className="flex items-end gap-[3px] h-8 mb-2">
          {sparkData.map((h, i) => (
            <div
              key={i}
              className={cn(
                'flex-1 bg-[#6d5aed] rounded-t-sm min-w-2 transition-[height] duration-300',
                i === sparkData.length - 1 ? 'opacity-100' : 'opacity-70',
              )}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between font-mono text-[9px] text-[#64748b]">
          {sparkLabels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 mb-4">
        {[
          { value: '$4.28', label: 'avg cost / build' },
          { value: '4.2', label: 'avg criteria / build' },
          { value: '87%', label: 'pass rate', good: true },
          { value: '14.5m', label: 'avg duration' },
        ].map((s, i) => (
          <div
            key={i}
            className="flex-1 bg-void border border-bdr rounded-[5px] p-3.5 text-center"
          >
            <div
              className={cn(
                'font-mono text-[22px] font-bold',
                s.good ? 'text-[#10b981]' : 'text-txt',
              )}
            >
              {s.value}
            </div>
            <div className="text-[10px] text-txt-dim mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Phase bottleneck chart */}
      <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
        <div className="text-[13px] font-semibold text-txt mb-4">Phase Bottlenecks</div>
        <div className="space-y-2">
          {[
            { phase: 'Implement', pct: 85, label: '5.2m avg' },
            { phase: 'Review', pct: 45, label: '2.8m avg' },
            { phase: 'Specify', pct: 40, label: '2.5m avg' },
            { phase: 'Design', pct: 30, label: '1.8m avg' },
            { phase: 'Explore', pct: 20, label: '1.2m avg' },
            { phase: 'Plan', pct: 18, label: '1.1m avg' },
            { phase: 'Validate', pct: 12, label: '0.7m avg' },
            { phase: 'Measure', pct: 8, label: '0.5m avg' },
          ].map((item) => (
            <div key={item.phase} className="flex items-center gap-3">
              <span className="font-mono text-xs text-txt-dim w-[100px] text-right shrink-0">
                {item.phase}
              </span>
              <div className="flex-1 h-5 bg-[#ffffff06] rounded-[4px] overflow-hidden">
                <div
                  className="h-full rounded-[4px] flex items-center pl-2 font-mono text-[10px] text-white font-semibold bg-gradient-to-r from-[#6d5aed] to-[#8b7cf7] transition-[width] duration-500"
                  style={{ width: `${item.pct}%` }}
                >
                  {item.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Failure patterns */}
      <div className="bg-abyss border border-bdr rounded-xl p-5">
        <div className="text-[13px] font-semibold text-txt mb-4">Failure Patterns</div>
        {[
          { name: 'G-NO-ANY', desc: 'Untyped parameters in generated code', pct: '30%' },
          { name: 'G-TSC', desc: 'TypeScript compilation errors', pct: '20%' },
          { name: 'G-TEST', desc: 'Test failures after implementation', pct: '15%' },
        ].map((fp) => (
          <div
            key={fp.name}
            className="flex items-center gap-3 mb-2.5 p-2.5 bg-void rounded-[5px] border border-bdr"
          >
            <span className="font-mono text-xs text-[#ef4444] w-[140px] shrink-0">
              {fp.name}
            </span>
            <span className="flex-1 text-xs text-txt-dim">{fp.desc}</span>
            <span className="font-mono text-xs text-txt font-semibold w-10 text-right">
              {fp.pct}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main export ──

export interface BuildDetailProps {
  build: BuildSummary;
}

export function BuildDetail({ build }: BuildDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <TabBar active={activeTab} onChange={setActiveTab} />
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'overview' && <OverviewTab build={build} />}
        {activeTab === 'artifacts' && <ArtifactsTab build={build} />}
        {activeTab === 'events' && <EventsTab build={build} />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
