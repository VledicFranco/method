import type { Node } from '@xyflow/react';
import type {
  VizNodeData,
  MethodologyNodeData,
  ScriptNodeData,
  GateNodeData,
} from '../lib/types';
import { StatusBadge } from './StatusBadge';

interface DetailPanelProps {
  node: Node<VizNodeData> | null;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function MethodologyDetails({ data }: { data: MethodologyNodeData }) {
  return (
    <>
      <div className="detail-panel__section">
        <div className="detail-panel__section-title">Configuration</div>
        <div className="detail-panel__row">
          <span className="detail-panel__row-label">Methodology</span>
          <span className="detail-panel__row-value">{data.methodology}</span>
        </div>
        {data.method_hint && (
          <div className="detail-panel__row">
            <span className="detail-panel__row-label">Method Hint</span>
            <span className="detail-panel__row-value">{data.method_hint}</span>
          </div>
        )}
      </div>

      {data.capabilities.length > 0 && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Capabilities</div>
          <ul className="detail-panel__list">
            {data.capabilities.map((cap) => (
              <li key={cap}>{cap}</li>
            ))}
          </ul>
        </div>
      )}

      {data.inputs.length > 0 && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Inputs</div>
          <ul className="detail-panel__list">
            {data.inputs.map((inp) => (
              <li key={inp}>{inp}</li>
            ))}
          </ul>
        </div>
      )}

      {data.outputs.length > 0 && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Outputs</div>
          <ul className="detail-panel__list">
            {data.outputs.map((out) => (
              <li key={out}>{out}</li>
            ))}
          </ul>
        </div>
      )}

      {data.gates.length > 0 && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Gates</div>
          {data.gates.map((gate, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div className="detail-panel__row">
                <span className="detail-panel__row-label">Type</span>
                <span className="detail-panel__row-value">{gate.type}</span>
              </div>
              <div className="detail-panel__code">{gate.check}</div>
            </div>
          ))}
        </div>
      )}

      {data.cost_usd != null && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Execution</div>
          <div className="detail-panel__row">
            <span className="detail-panel__row-label">Cost</span>
            <span className="detail-panel__row-value">
              {formatCost(data.cost_usd)}
            </span>
          </div>
          {data.duration_ms != null && (
            <div className="detail-panel__row">
              <span className="detail-panel__row-label">Duration</span>
              <span className="detail-panel__row-value">
                {formatDuration(data.duration_ms)}
              </span>
            </div>
          )}
          {data.retries != null && data.retries > 0 && (
            <div className="detail-panel__row">
              <span className="detail-panel__row-label">Retries</span>
              <span className="detail-panel__row-value">{data.retries}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ScriptDetails({ data }: { data: ScriptNodeData }) {
  return (
    <>
      <div className="detail-panel__section">
        <div className="detail-panel__section-title">Script</div>
        <div className="detail-panel__code">{data.script}</div>
      </div>

      {data.inputs.length > 0 && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Inputs</div>
          <ul className="detail-panel__list">
            {data.inputs.map((inp) => (
              <li key={inp}>{inp}</li>
            ))}
          </ul>
        </div>
      )}

      {data.outputs.length > 0 && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Outputs</div>
          <ul className="detail-panel__list">
            {data.outputs.map((out) => (
              <li key={out}>{out}</li>
            ))}
          </ul>
        </div>
      )}

      {data.duration_ms != null && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Execution</div>
          <div className="detail-panel__row">
            <span className="detail-panel__row-label">Duration</span>
            <span className="detail-panel__row-value">
              {formatDuration(data.duration_ms)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function GateDetails({ data }: { data: GateNodeData }) {
  return (
    <>
      <div className="detail-panel__section">
        <div className="detail-panel__section-title">Check Expression</div>
        <div className="detail-panel__code">{data.check}</div>
      </div>

      {data.depends_on.length > 0 && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Depends On</div>
          <ul className="detail-panel__list">
            {data.depends_on.map((dep) => (
              <li key={dep}>{dep}</li>
            ))}
          </ul>
        </div>
      )}

      {data.error && (
        <div className="detail-panel__section">
          <div className="detail-panel__section-title">Error</div>
          <div className="detail-panel__error">{data.error}</div>
        </div>
      )}
    </>
  );
}

export function DetailPanel({ node, onClose }: DetailPanelProps) {
  const isOpen = node !== null;
  const panelClass = `detail-panel${isOpen ? ' detail-panel--open' : ''}`;

  if (!node) {
    return <div className={panelClass} />;
  }

  const d = node.data;
  const typeLabel =
    d.nodeType === 'methodology'
      ? 'Methodology Node'
      : d.nodeType === 'script'
        ? 'Script Node'
        : 'Strategy Gate';

  return (
    <div className={panelClass}>
      <button className="detail-panel__close" onClick={onClose}>
        x
      </button>

      <div className="detail-panel__title">{d.label}</div>
      <div className="detail-panel__type">{typeLabel}</div>

      <div className="detail-panel__section">
        <div className="detail-panel__section-title">Status</div>
        <StatusBadge
          status={
            d.nodeType === 'gate'
              ? (d as GateNodeData).status
              : (d as MethodologyNodeData | ScriptNodeData).status
          }
        />
      </div>

      {d.nodeType === 'methodology' && (
        <MethodologyDetails data={d as MethodologyNodeData} />
      )}
      {d.nodeType === 'script' && (
        <ScriptDetails data={d as ScriptNodeData} />
      )}
      {d.nodeType === 'gate' && <GateDetails data={d as GateNodeData} />}

      {/* Error display for non-gate nodes */}
      {d.nodeType !== 'gate' &&
        (d as MethodologyNodeData | ScriptNodeData).error && (
          <div className="detail-panel__section">
            <div className="detail-panel__section-title">Error</div>
            <div className="detail-panel__error">
              {(d as MethodologyNodeData | ScriptNodeData).error}
            </div>
          </div>
        )}
    </div>
  );
}
