/**
 * PRD 019.2 Component 3: Method Detail View (Main Content)
 *
 * Tabbed detail view for methods and protocols:
 *   Methods:   Navigation, Domain Theory, Steps, Compilation Record, Known WIP, Evolution (placeholder)
 *   Protocols: Navigation, Domain Theory, Installation, Promotion, Known WIP, Evolution (placeholder)
 *
 * Protocol items show a lifecycle pipeline (draft -> trial -> promoted) and
 * a Promotion tab with criteria checklist when a promotion record exists.
 */

import { useState } from 'react';
import {
  Check, X, Minus, AlertTriangle,
  BookOpen, Atom, ListOrdered, ShieldCheck, AlertCircle,
  Package, Award, Star, FlaskConical, Circle, ArrowRight, History,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Tabs } from '@/shared/components/Tabs';
import { Card } from '@/shared/components/Card';
import { Badge } from '@/shared/components/Badge';
import { usePromotionRecord } from '@/domains/registry/useRegistry';
import type {
  MethodDetail as MethodDetailData,
  MethodNavigation,
  DomainTheory,
  StepPhase,
  CompilationGate,
  KnownWipItem,
  PromotionRecord,
  PromotionCriterion,
} from '@/domains/registry/types';

// ── Sub-components ──

function StatusBadgeForMethod({ status }: { status: string }) {
  if (status === 'compiled') return <Badge variant="bio" label="Compiled" icon={<Check className="h-3 w-3" />} />;
  if (status === 'promoted') return <Badge variant="cyan" label="Promoted" icon={<Star className="h-3 w-3" />} />;
  if (status === 'trial') return <Badge variant="solar" label="Trial" icon={<FlaskConical className="h-3 w-3" />} />;
  return <Badge variant="muted" label="Draft" icon={<Circle className="h-3 w-3" />} />;
}

// ── Tab: Navigation ──

function NavigationTab({ nav }: { nav: MethodNavigation }) {
  const whenItems = nav.when_to_use ?? nav.when_to_invoke ?? [];
  const whenNotItems = nav.when_not_to_use ?? nav.when_not_to_invoke ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NavCard label="What" content={nav.what} />
        <NavCard label="Who" content={nav.who} />
      </div>
      {nav.why && <NavCard label="Why" content={nav.why} fullWidth />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NavCard label="How" content={nav.how} />
        {whenItems.length > 0 && (
          <NavCard label="When" items={whenItems} />
        )}
      </div>
      {whenNotItems.length > 0 && (
        <Card accent="error" padding="md">
          <p className="font-mono text-[0.65rem] text-txt-muted uppercase tracking-wider mb-2">
            When Not To Use
          </p>
          <ul className="space-y-1">
            {whenNotItems.map((item, i) => (
              <li key={i} className="text-sm text-txt-dim flex gap-2">
                <span className="text-error shrink-0 mt-0.5">-</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function NavCard({ label, content, items, fullWidth }: {
  label: string;
  content?: string;
  items?: string[];
  fullWidth?: boolean;
}) {
  return (
    <Card padding="md" className={fullWidth ? 'md:col-span-2' : ''}>
      <p className="font-mono text-[0.65rem] text-txt-muted uppercase tracking-wider mb-2">{label}</p>
      {content && <p className="text-sm text-txt-dim leading-relaxed">{content}</p>}
      {items && (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-sm text-txt-dim flex gap-2">
              <span className="text-bio shrink-0 mt-0.5">-</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Tab: Domain Theory ──

function DomainTheoryTab({ theory }: { theory: DomainTheory }) {
  return (
    <div className="space-y-6">
      {/* Sorts */}
      {theory.sorts && theory.sorts.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-semibold text-txt mb-3">Sorts</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bdr">
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Sort</th>
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Description</th>
                  <th className="text-left py-2 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Cardinality</th>
                </tr>
              </thead>
              <tbody>
                {theory.sorts.map((s) => (
                  <tr key={s.name} className="border-b border-bdr/50">
                    <td className="py-2 pr-4 font-mono text-bio text-[0.8rem]">{s.name}</td>
                    <td className="py-2 pr-4 text-txt-dim">{s.description ?? '--'}</td>
                    <td className="py-2 font-mono text-[0.75rem] text-txt-muted">{s.cardinality ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Predicates */}
      {theory.predicates && theory.predicates.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-semibold text-txt mb-3">Predicates</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bdr">
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Predicate</th>
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Signature</th>
                  <th className="text-left py-2 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody>
                {theory.predicates.map((p) => (
                  <tr key={p.name} className="border-b border-bdr/50">
                    <td className="py-2 pr-4 font-mono text-bio text-[0.8rem]">{p.name}</td>
                    <td className="py-2 pr-4 font-mono text-[0.75rem] text-txt-dim">{p.signature ?? '--'}</td>
                    <td className="py-2 text-txt-dim">{p.description ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Function Symbols */}
      {theory.function_symbols && theory.function_symbols.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-semibold text-txt mb-3">Function Symbols</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bdr">
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Symbol</th>
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Signature</th>
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Totality</th>
                  <th className="text-left py-2 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody>
                {theory.function_symbols.map((fs) => (
                  <tr key={fs.name} className="border-b border-bdr/50">
                    <td className="py-2 pr-4 font-mono text-bio text-[0.8rem]">{fs.name}</td>
                    <td className="py-2 pr-4 font-mono text-[0.75rem] text-txt-dim">{fs.signature ?? '--'}</td>
                    <td className="py-2 pr-4 font-mono text-[0.75rem] text-txt-muted">{fs.totality ?? '--'}</td>
                    <td className="py-2 text-txt-dim">{fs.description ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Axioms */}
      {theory.axioms && theory.axioms.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-semibold text-txt mb-3">Axioms</h3>
          <div className="space-y-3">
            {theory.axioms.map((ax) => (
              <AxiomCard key={ax.id} axiom={ax} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AxiomCard({ axiom }: { axiom: { id: string; name: string; statement?: string; rationale?: string } }) {
  const [showRationale, setShowRationale] = useState(false);

  return (
    <Card padding="sm">
      <div className="flex items-start gap-3">
        <span className="font-mono text-[0.7rem] text-bio bg-bio-dim px-1.5 py-0.5 rounded shrink-0">{axiom.id}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-txt">{axiom.name}</p>
          {axiom.statement && (
            <p className="mt-1 font-mono text-[0.7rem] text-txt-dim leading-relaxed break-words">{axiom.statement}</p>
          )}
          {axiom.rationale && (
            <div className="mt-2">
              <button
                onClick={() => setShowRationale(!showRationale)}
                className="text-[0.7rem] text-txt-muted hover:text-txt-dim transition-colors"
              >
                {showRationale ? 'Hide rationale' : 'Show rationale'}
              </button>
              {showRationale && (
                <p className="mt-1 text-[0.75rem] text-txt-muted leading-relaxed">{axiom.rationale}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Tab: Steps ──

function StepsTab({ phases }: { phases: StepPhase[] }) {
  if (!phases || phases.length === 0) {
    return <p className="text-sm text-txt-dim py-4">No step data available.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Simple horizontal step flow */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 pt-2">
        {phases.map((phase, i) => (
          <div key={phase.id} className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'h-12 w-12 rounded-full flex items-center justify-center',
                  'border-2 border-bio bg-abyss',
                  'font-mono text-[0.7rem] text-bio',
                  'hover:shadow-[0_0_12px_2px_var(--bio-glow)] transition-shadow duration-200',
                )}
              >
                {phase.id.replace('sigma_', 's')}
              </div>
              <span className="text-[0.65rem] text-txt-dim max-w-[80px] text-center truncate">
                {phase.name}
              </span>
            </div>
            {i < phases.length - 1 && (
              <ArrowRight className="h-4 w-4 text-bdr shrink-0 mb-5" />
            )}
          </div>
        ))}
      </div>

      {/* Step detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bdr">
              <th className="text-left py-2 pr-3 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Step</th>
              <th className="text-left py-2 pr-3 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Name</th>
              <th className="text-left py-2 pr-3 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Precondition</th>
              <th className="text-left py-2 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Postcondition</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase) => (
              <tr key={phase.id} className="border-b border-bdr/50">
                <td className="py-2 pr-3 font-mono text-bio text-[0.8rem]">{phase.id}</td>
                <td className="py-2 pr-3 text-txt">{phase.name}</td>
                <td className="py-2 pr-3 text-[0.75rem] text-txt-dim max-w-[200px] truncate">
                  {phase.precondition ?? phase.initial_condition_claim ?? '--'}
                </td>
                <td className="py-2 text-[0.75rem] text-txt-dim max-w-[200px] truncate">
                  {phase.postcondition ?? phase.terminal_condition_claim ?? '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Compilation Record ──

const GATE_NAMES: Record<string, string> = {
  G0: 'YAML Structure',
  G1: 'Navigation Completeness',
  G2: 'Domain Theory',
  G3: 'Step DAG',
  G4: 'Predicate Coverage',
  G5: 'Axiom Grounding',
  G6: 'Cross-Reference',
};

function GateStatusIcon({ result }: { result: string }) {
  if (result === 'PASS') {
    return (
      <div className="h-7 w-7 rounded-full bg-bio-dim flex items-center justify-center shrink-0">
        <Check className="h-4 w-4 text-bio" />
      </div>
    );
  }
  if (result === 'FAIL') {
    return (
      <div className="h-7 w-7 rounded-full bg-error-dim flex items-center justify-center shrink-0">
        <X className="h-4 w-4 text-error" />
      </div>
    );
  }
  if (result === 'PASS_WITH_WIP') {
    return (
      <div className="h-7 w-7 rounded-full bg-solar-dim flex items-center justify-center shrink-0">
        <AlertTriangle className="h-4 w-4 text-solar" />
      </div>
    );
  }
  // DEFERRED or unknown
  return (
    <div className="h-7 w-7 rounded-full bg-txt-muted/10 flex items-center justify-center shrink-0">
      <Minus className="h-4 w-4 text-txt-muted" />
    </div>
  );
}

function CompilationTab({ gates }: { gates: CompilationGate[] }) {
  return (
    <div className="space-y-3">
      {gates.map((g) => (
        <Card key={g.gate} padding="sm">
          <div className="flex items-start gap-3">
            <GateStatusIcon result={g.result} />
            <div className="flex-1 min-w-0">
              <p className="font-mono text-sm text-txt">
                {g.gate} — {GATE_NAMES[g.gate] ?? g.gate}
              </p>
              {g.note && (
                <p className="mt-1 text-[0.75rem] text-txt-dim leading-relaxed line-clamp-3">
                  {g.note}
                </p>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function NoCompilationRecord() {
  return (
    <Card padding="lg">
      <div className="text-center py-4">
        <ShieldCheck className="h-8 w-8 text-txt-muted mx-auto mb-3" />
        <p className="text-sm text-txt-dim">
          No compilation record. Protocols follow a lifecycle model instead of compilation gates.
        </p>
      </div>
    </Card>
  );
}

// ── Tab: Known WIP ──

function WipTab({ items }: { items: KnownWipItem[] }) {
  if (!items || items.length === 0) {
    return (
      <Card padding="lg">
        <p className="text-sm text-txt-dim text-center py-4">No known work-in-progress items.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isResolved = item.status.startsWith('resolved');
        return (
          <Card key={item.id} padding="sm">
            <div className="flex items-start gap-3">
              <Badge
                variant={isResolved ? 'cyan' : 'solar'}
                label={isResolved ? 'Resolved' : 'Open'}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm text-txt">{item.id}</p>
                {item.description && (
                  <p className="mt-1 text-[0.75rem] text-txt-dim leading-relaxed">{item.description}</p>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Protocol Lifecycle Pipeline ──

function LifecyclePipeline({ currentStage }: { currentStage: string }) {
  const stages = ['draft', 'trial', 'promoted'];
  const currentIndex = stages.indexOf(currentStage);

  return (
    <div className="flex items-center gap-2 py-3">
      {stages.map((stage, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <div key={stage} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.75rem] font-medium',
                isComplete && 'bg-cyan/15 text-cyan',
                isCurrent && (stage === 'promoted' ? 'bg-cyan/15 text-cyan' : stage === 'trial' ? 'bg-solar-dim text-solar' : 'bg-txt-muted/10 text-txt-dim'),
                !isComplete && !isCurrent && 'bg-abyss text-txt-muted',
              )}
            >
              {isComplete && <Check className="h-3 w-3" />}
              {isCurrent && stage === 'promoted' && <Star className="h-3 w-3" />}
              {isCurrent && stage === 'trial' && <FlaskConical className="h-3 w-3" />}
              {isCurrent && stage === 'draft' && <Circle className="h-3 w-3" />}
              {stage}
            </div>
            {i < stages.length - 1 && (
              <ArrowRight className={cn(
                'h-3.5 w-3.5',
                i < currentIndex ? 'text-cyan' : 'text-txt-muted',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Installation Tab (Protocol) ──

function InstallationTab({ installation }: { installation: NonNullable<MethodDetailData['protocol']>['installation'] }) {
  if (!installation) {
    return <p className="text-sm text-txt-dim py-4">No installation data available.</p>;
  }

  return (
    <div className="space-y-4">
      {installation.description && (
        <p className="text-sm text-txt-dim">{installation.description}</p>
      )}
      {installation.artifacts && installation.artifacts.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-semibold text-txt mb-3">Required Artifacts</h3>
          <div className="space-y-2">
            {installation.artifacts.map((art, i) => (
              <Card key={i} padding="sm">
                <div className="flex items-start gap-3">
                  <Package className="h-4 w-4 text-bio shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[0.8rem] text-txt">{art.path}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={art.required ? 'bio' : 'muted'} label={art.required ? 'Required' : 'Optional'} size="sm" />
                      {art.type && <Badge variant="muted" label={art.type} size="sm" />}
                    </div>
                    {art.description && (
                      <p className="mt-1 text-[0.7rem] text-txt-dim">{art.description}</p>
                    )}
                    {art.template_note && (
                      <p className="mt-1 text-[0.65rem] text-txt-muted italic">{art.template_note}</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Promotion (Protocol) ──

function PromotionTab({
  promotionRecord,
  isLoading,
  isError,
}: {
  promotionRecord: PromotionRecord | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 w-48 bg-abyss-light rounded" />
        <div className="h-16 bg-abyss-light rounded-card" />
        <div className="h-16 bg-abyss-light rounded-card" />
      </div>
    );
  }

  if (isError || !promotionRecord?.proposal) {
    return (
      <Card padding="lg">
        <div className="text-center py-4">
          <Award className="h-8 w-8 text-txt-muted mx-auto mb-3" />
          <p className="text-sm text-txt-dim">
            No promotion criteria recorded. Promotion data will appear here when a
            promotion proposal exists for this protocol.
          </p>
        </div>
      </Card>
    );
  }

  const { proposal } = promotionRecord;
  const criteria = proposal.criteria_met ?? [];

  return (
    <div className="space-y-6">
      {/* Proposal header */}
      <Card padding="md">
        <div className="flex items-start gap-3">
          <Award className="h-5 w-5 text-cyan shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-bio font-medium">{proposal.id}</span>
              {proposal.status && (
                <Badge
                  variant={proposal.status === 'approved' ? 'bio' : proposal.status === 'pending' ? 'solar' : 'muted'}
                  label={proposal.status}
                  size="sm"
                />
              )}
            </div>
            <p className="font-display text-sm font-semibold text-txt mt-1">{proposal.name}</p>
            {proposal.date && (
              <p className="text-[0.75rem] text-txt-muted mt-1">{proposal.date}</p>
            )}
            {proposal.summary && (
              <p className="text-sm text-txt-dim mt-2 leading-relaxed">{proposal.summary}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Criteria checklist */}
      {criteria.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-semibold text-txt mb-3">Promotion Criteria</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bdr">
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider w-8" />
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Criterion</th>
                  <th className="text-left py-2 pr-4 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Result</th>
                  <th className="text-left py-2 font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {criteria.map((c: PromotionCriterion, i: number) => (
                  <tr key={i} className="border-b border-bdr/50">
                    <td className="py-2 pr-4">
                      <div
                        className={cn(
                          'h-5 w-5 rounded-full flex items-center justify-center',
                          c.met ? 'bg-bio-dim' : 'bg-error-dim',
                        )}
                      >
                        {c.met ? (
                          <Check className="h-3 w-3 text-bio" />
                        ) : (
                          <X className="h-3 w-3 text-error" />
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 font-mono text-[0.8rem] text-txt">
                      {c.criterion ?? c.metric ?? '--'}
                    </td>
                    <td className="py-2 pr-4 text-[0.8rem] text-txt-dim">
                      {c.result ?? c.threshold ?? '--'}
                    </td>
                    <td className="py-2 text-[0.75rem] text-txt-muted max-w-[300px]">
                      {c.evidence ?? '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Evolution (Placeholder — Phase 2) ──

function EvolutionTab() {
  return (
    <Card padding="lg">
      <div className="text-center py-8">
        <History className="h-10 w-10 text-txt-muted mx-auto mb-4" />
        <p className="font-display text-sm font-semibold text-txt mb-2">Evolution History</p>
        <p className="text-sm text-txt-dim max-w-md mx-auto leading-relaxed">
          Coming soon — evolution history will appear here. Version timelines, gap candidate
          tracking, and pre/post evolution observation rates will be visualized from
          EVOLUTION-LEDGER.yaml and CHANGELOG.yaml data.
        </p>
      </div>
    </Card>
  );
}

// ── Main Component ──

export interface MethodDetailProps {
  data: MethodDetailData;
  methodologyId: string;
  className?: string;
}

export function MethodDetail({ data, methodologyId, className }: MethodDetailProps) {
  const isProtocol = !!data.protocol;
  const meta = data.method ?? data.protocol;
  const protocolId = isProtocol ? meta?.id ?? null : null;

  // Fetch promotion record for protocols (hook is always called, but disabled for methods)
  const {
    data: promotionRecord,
    isLoading: promotionLoading,
    isError: promotionError,
  } = usePromotionRecord(
    isProtocol ? methodologyId : null,
    protocolId,
  );

  const [activeTab, setActiveTab] = useState('navigation');

  if (!meta) return null;

  const id = meta.id;
  const name = meta.name;
  const version = meta.version;
  const status = meta.status ?? (data.protocol?.maturity as string) ?? 'draft';
  const compilationDate = data.method?.compilation_date ?? data.protocol?.date;

  // Build tab list based on type
  const methodTabs = [
    { id: 'navigation', label: 'Navigation', icon: <BookOpen className="h-3.5 w-3.5" /> },
    ...(data.domain_theory ? [{ id: 'theory', label: 'Domain Theory', icon: <Atom className="h-3.5 w-3.5" /> }] : []),
    ...(data.phases || data.step_dag ? [{ id: 'steps', label: 'Steps', icon: <ListOrdered className="h-3.5 w-3.5" /> }] : []),
    ...(data.compilation_record ? [{ id: 'compilation', label: 'Compilation', icon: <ShieldCheck className="h-3.5 w-3.5" /> }] : []),
    ...(!data.compilation_record && isProtocol ? [{ id: 'compilation', label: 'Compilation', icon: <ShieldCheck className="h-3.5 w-3.5" /> }] : []),
    ...(isProtocol && data.protocol?.installation ? [{ id: 'installation', label: 'Installation', icon: <Package className="h-3.5 w-3.5" /> }] : []),
    ...(isProtocol ? [{ id: 'promotion', label: 'Promotion', icon: <Award className="h-3.5 w-3.5" /> }] : []),
    { id: 'wip', label: 'Known WIP', icon: <AlertCircle className="h-3.5 w-3.5" />, count: data.known_wip?.length ?? 0 },
    { id: 'evolution', label: 'Evolution', icon: <History className="h-3.5 w-3.5" /> },
  ];

  // Get phases from either phases array or step_dag
  const phases = data.phases ?? data.step_dag?.steps ?? [];

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="pb-4 border-b border-bdr mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[0.8rem] text-bio">{methodologyId} / {id}</span>
          <StatusBadgeForMethod status={status} />
        </div>
        <h2 className="font-display text-xl text-txt font-semibold tracking-tight">{name}</h2>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="font-mono text-[0.75rem] text-txt-dim">v{version}</span>
          {compilationDate && (
            <span className="text-[0.75rem] text-txt-muted">{compilationDate}</span>
          )}
        </div>

        {/* Protocol lifecycle pipeline */}
        {isProtocol && (
          <LifecyclePipeline currentStage={status} />
        )}
      </div>

      {/* Tabs */}
      <Tabs tabs={methodTabs} activeTab={activeTab} onTabChange={setActiveTab} className="mb-4" />

      {/* Tab content */}
      <div className="flex-1">
        {activeTab === 'navigation' && data.navigation && (
          <NavigationTab nav={data.navigation} />
        )}
        {activeTab === 'navigation' && !data.navigation && (
          <p className="text-sm text-txt-dim py-4">No navigation data available.</p>
        )}

        {activeTab === 'theory' && data.domain_theory && (
          <DomainTheoryTab theory={data.domain_theory} />
        )}

        {activeTab === 'steps' && (
          <StepsTab phases={phases} />
        )}

        {activeTab === 'compilation' && data.compilation_record && (
          <CompilationTab gates={data.compilation_record.gates} />
        )}
        {activeTab === 'compilation' && !data.compilation_record && (
          <NoCompilationRecord />
        )}

        {activeTab === 'installation' && isProtocol && (
          <InstallationTab installation={data.protocol!.installation} />
        )}

        {activeTab === 'promotion' && isProtocol && (
          <PromotionTab
            promotionRecord={promotionRecord}
            isLoading={promotionLoading}
            isError={promotionError}
          />
        )}

        {activeTab === 'wip' && (
          <WipTab items={data.known_wip ?? []} />
        )}

        {activeTab === 'evolution' && (
          <EvolutionTab />
        )}
      </div>
    </div>
  );
}
