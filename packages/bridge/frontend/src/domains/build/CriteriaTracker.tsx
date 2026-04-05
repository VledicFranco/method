/**
 * CriteriaTracker — Success criteria checklist from FeatureSpec.
 *
 * Each criterion shows status:
 *   pending (gray circle), passed (green check), failed (red X)
 * Evidence snippet expandable for evaluated criteria.
 *
 * @see PRD 047 §Dashboard Architecture — Success Criteria Tracker
 */

import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import type { TestableAssertion } from './types';

function CriterionIcon({ status }: { status: TestableAssertion['status'] }) {
  switch (status) {
    case 'passed':
      return (
        <span className="w-5 h-5 rounded-full bg-[#10b981] text-black text-[11px] font-bold flex items-center justify-center shrink-0">
          &#10003;
        </span>
      );
    case 'failed':
      return (
        <span className="w-5 h-5 rounded-full bg-[#ef4444] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          &#10007;
        </span>
      );
    default:
      return (
        <span className="w-5 h-5 rounded-full border-2 border-bdr text-txt-dim text-[11px] flex items-center justify-center shrink-0">
          &#9675;
        </span>
      );
  }
}

function CriterionRow({ criterion }: { criterion: TestableAssertion }) {
  const [expanded, setExpanded] = useState(false);
  const hasEvidence = criterion.evidence != null;

  return (
    <li
      className={cn(
        'flex items-center gap-2.5 py-2 border-b border-[#ffffff06] last:border-b-0',
        hasEvidence && 'cursor-pointer',
      )}
      onClick={() => hasEvidence && setExpanded(!expanded)}
    >
      <CriterionIcon status={criterion.status} />
      <span
        className={cn(
          'font-mono text-xs',
          criterion.status === 'pending' ? 'text-txt-dim' : 'text-txt',
        )}
      >
        {criterion.name}
      </span>
      {hasEvidence && (
        <span className="ml-auto text-[10px] text-[#64748b]">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
      )}
      {expanded && criterion.evidence && (
        <div className="mt-1 ml-7 font-mono text-[10px] text-txt-dim bg-[#0a0a0f] p-2 rounded border border-bdr">
          {criterion.evidence}
        </div>
      )}
    </li>
  );
}

export interface CriteriaTrackerProps {
  criteria: TestableAssertion[];
  /** Label shown in the card subtitle (e.g., "Phase 7 eval" or "3/3 passed") */
  subtitle?: string;
}

export function CriteriaTracker({ criteria, subtitle }: CriteriaTrackerProps) {
  const passed = criteria.filter((c) => c.status === 'passed').length;
  const total = criteria.length;
  const defaultSubtitle =
    criteria.every((c) => c.status === 'pending')
      ? 'Phase 7 eval'
      : `${passed}/${total} passed`;

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-txt">Success Criteria</div>
        <div className="font-mono text-[11px] text-txt-dim">{subtitle ?? defaultSubtitle}</div>
      </div>
      <ul className="list-none">
        {criteria.map((c, i) => (
          <CriterionRow key={i} criterion={c} />
        ))}
        {criteria.length === 0 && (
          <li className="text-[13px] text-txt-dim italic">No criteria defined yet</li>
        )}
      </ul>
    </div>
  );
}
