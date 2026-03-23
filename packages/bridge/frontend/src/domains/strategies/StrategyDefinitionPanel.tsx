/**
 * PRD 019.3: Structured YAML rendering for the strategy detail slide-over.
 *
 * Renders the strategy definition as structured UI elements:
 * 1. Identity — ID, name, version, file_path
 * 2. Context Inputs — input parameters with types and defaults
 * 3. DAG Nodes — node cards with type dot, metadata, gates
 * 4. Strategy Gates — gate cards with diamond icon, check expression
 * 5. Triggers — trigger config items with type badges
 * 6. Oversight Rules — condition (solar) + action
 * 7. Outputs — type and target
 */

import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import type {
  StrategyDefinition,
  StrategyNodeDef,
  StrategyGateDef,
  OversightRuleDef,
  ContextInputDef,
} from '@/lib/types';

// ── Section components ──────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display text-xs font-semibold text-txt-dim uppercase tracking-wider mb-sp-3 mt-sp-5 first:mt-0">
      {children}
    </h3>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-xs text-txt-muted font-medium w-24 shrink-0">{label}</span>
      <span className="text-xs text-txt font-mono break-all">{value}</span>
    </div>
  );
}

// ── Node card ──

function NodeCard({ node }: { node: StrategyNodeDef }) {
  const dotColor = node.type === 'methodology' ? 'bg-nebular' : 'bg-bio';
  const typeLabel = node.type === 'methodology' ? 'methodology' : 'script';

  return (
    <div className="rounded-lg border border-bdr bg-void/50 p-sp-3 mb-sp-2">
      {/* Header: dot + ID + type badge */}
      <div className="flex items-center gap-2 mb-sp-2">
        <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', dotColor)} />
        <span className="font-mono text-xs text-txt font-bold">{node.id}</span>
        <Badge
          variant={node.type === 'methodology' ? 'nebular' : 'bio'}
          label={typeLabel}
        />
      </div>

      {/* Metadata */}
      <div className="pl-[18px] space-y-0.5">
        {node.methodology && (
          <p className="text-[0.7rem] text-txt-dim">
            <span className="text-txt-muted">methodology:</span>{' '}
            <span className="font-mono">{node.methodology}</span>
          </p>
        )}
        {node.method_hint && (
          <p className="text-[0.7rem] text-txt-dim">
            <span className="text-txt-muted">method_hint:</span>{' '}
            <span className="font-mono">{node.method_hint}</span>
          </p>
        )}
        {node.depends_on.length > 0 && (
          <p className="text-[0.7rem] text-txt-dim">
            <span className="text-txt-muted">depends_on:</span>{' '}
            <span className="font-mono">{node.depends_on.join(', ')}</span>
          </p>
        )}
        {node.inputs.length > 0 && (
          <p className="text-[0.7rem] text-txt-dim">
            <span className="text-txt-muted">inputs:</span>{' '}
            <span className="font-mono">{node.inputs.join(', ')}</span>
          </p>
        )}
        {node.outputs.length > 0 && (
          <p className="text-[0.7rem] text-txt-dim">
            <span className="text-txt-muted">outputs:</span>{' '}
            <span className="font-mono">{node.outputs.join(', ')}</span>
          </p>
        )}
        {node.gates.length > 0 && (
          <div className="mt-1">
            <p className="text-[0.7rem] text-txt-muted mb-0.5">gates:</p>
            {node.gates.map((g, i) => (
              <div key={i} className="pl-3 text-[0.7rem] text-txt-dim">
                <span className="text-cyan font-mono">{g.type}</span>
                {' -- '}
                <span className="font-mono text-txt-muted">{g.check}</span>
                <span className="text-txt-muted"> (retries: {g.max_retries})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Gate card ──

function GateCard({ gate }: { gate: StrategyGateDef }) {
  return (
    <div className="rounded-lg border border-bdr bg-void/50 p-sp-3 mb-sp-2">
      <div className="flex items-center gap-2 mb-sp-2">
        {/* Diamond icon */}
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
          <rect
            x="1"
            y="1"
            width="8"
            height="8"
            rx="1"
            fill="var(--cyan)"
            transform="rotate(45 5 5)"
          />
        </svg>
        <span className="font-mono text-xs text-txt font-bold">{gate.id}</span>
        <Badge variant="cyan" label={gate.type} />
      </div>
      <div className="pl-[18px] space-y-0.5">
        <p className="text-[0.7rem] text-txt-dim">
          <span className="text-txt-muted">check:</span>{' '}
          <span className="font-mono">{gate.check}</span>
        </p>
        {gate.depends_on.length > 0 && (
          <p className="text-[0.7rem] text-txt-dim">
            <span className="text-txt-muted">depends_on:</span>{' '}
            <span className="font-mono">{gate.depends_on.join(', ')}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Trigger config card ──

function TriggerConfigCard({ trigger }: { trigger: { type: string; config: Record<string, unknown> } }) {
  const variant =
    trigger.type === 'manual'
      ? 'muted' as const
      : trigger.type === 'file_watch'
        ? 'solar' as const
        : trigger.type === 'git_commit'
          ? 'nebular' as const
          : trigger.type === 'schedule'
            ? 'cyan' as const
            : 'bio' as const;

  return (
    <div className="rounded-lg border border-bdr bg-void/50 p-sp-3">
      <div className="flex items-center gap-2 mb-1">
        <Badge variant={variant} label={trigger.type} />
      </div>
      {Object.keys(trigger.config).length > 0 && (
        <div className="pl-1 space-y-0.5">
          {Object.entries(trigger.config).map(([key, val]) => (
            <p key={key} className="text-[0.7rem] text-txt-dim">
              <span className="text-txt-muted">{key}:</span>{' '}
              <span className="font-mono">
                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Oversight rule ──

function OversightRuleCard({ rule }: { rule: OversightRuleDef }) {
  return (
    <div className="rounded-lg border border-bdr bg-void/50 p-sp-3 mb-sp-2">
      <p className="text-[0.7rem]">
        <span className="font-mono text-solar">{rule.condition}</span>
      </p>
      <p className="text-[0.7rem] text-txt-dim mt-0.5">
        <span className="text-txt-muted">action:</span> {rule.action}
      </p>
    </div>
  );
}

// ── Context input ──

function ContextInputRow({ input }: { input: ContextInputDef }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="font-mono text-xs text-txt">{input.name}</span>
      <Badge variant="default" label={input.type} />
      {input.default !== undefined && (
        <span className="text-[0.7rem] text-txt-muted font-mono">
          = {JSON.stringify(input.default)}
        </span>
      )}
    </div>
  );
}

// ── Main panel component ──

export interface StrategyDefinitionPanelProps {
  definition: StrategyDefinition;
  className?: string;
}

export function StrategyDefinitionPanel({
  definition,
  className,
}: StrategyDefinitionPanelProps) {
  return (
    <div className={cn('space-y-0', className)}>
      {/* Identity */}
      <SectionHeading>Identity</SectionHeading>
      <div className="space-y-0">
        <FieldRow label="ID" value={definition.id} />
        <FieldRow label="Name" value={definition.name} />
        <FieldRow label="Version" value={definition.version} />
        <FieldRow label="File" value={definition.file_path} />
      </div>

      {/* Context Inputs */}
      {definition.context_inputs.length > 0 && (
        <>
          <SectionHeading>Context Inputs</SectionHeading>
          <div>
            {definition.context_inputs.map((ci) => (
              <ContextInputRow key={ci.name} input={ci} />
            ))}
          </div>
        </>
      )}

      {/* DAG Nodes */}
      <SectionHeading>DAG Nodes ({definition.nodes.length})</SectionHeading>
      <div>
        {definition.nodes.map((node) => (
          <NodeCard key={node.id} node={node} />
        ))}
      </div>

      {/* Strategy Gates */}
      {definition.strategy_gates.length > 0 && (
        <>
          <SectionHeading>Strategy Gates ({definition.strategy_gates.length})</SectionHeading>
          <div>
            {definition.strategy_gates.map((gate) => (
              <GateCard key={gate.id} gate={gate} />
            ))}
          </div>
        </>
      )}

      {/* Triggers */}
      {definition.triggers.length > 0 && (
        <>
          <SectionHeading>Triggers ({definition.triggers.length})</SectionHeading>
          <div className="space-y-sp-2">
            {definition.triggers.map((t, i) => (
              <TriggerConfigCard key={i} trigger={t} />
            ))}
          </div>
        </>
      )}

      {/* Oversight Rules */}
      {definition.oversight_rules.length > 0 && (
        <>
          <SectionHeading>Oversight Rules ({definition.oversight_rules.length})</SectionHeading>
          <div>
            {definition.oversight_rules.map((rule, i) => (
              <OversightRuleCard key={i} rule={rule} />
            ))}
          </div>
        </>
      )}

      {/* Outputs */}
      {definition.outputs.length > 0 && (
        <>
          <SectionHeading>Outputs</SectionHeading>
          <div>
            {definition.outputs.map((o, i) => (
              <FieldRow key={i} label="type" value={`${o.type} -> ${o.target}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
