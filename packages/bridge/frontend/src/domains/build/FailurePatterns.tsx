/**
 * FailurePatterns — Table of gate failure frequencies sorted descending.
 *
 * Each row: gate name (red), description, frequency %.
 *
 * @see PRD 047 §Analytics — Failure Patterns
 */

export interface FailurePattern {
  readonly gate: string;
  readonly description: string;
  readonly frequencyPct: number;
}

const FAILURE_DATA: FailurePattern[] = [
  { gate: 'G-NO-ANY', description: 'Untyped parameters in generated code', frequencyPct: 40 },
  { gate: 'G-TSC', description: 'TypeScript compilation errors', frequencyPct: 25 },
  { gate: 'G-TEST', description: 'Test failures after implementation', frequencyPct: 15 },
  { gate: 'G-IMPORT', description: 'Cross-boundary import violations', frequencyPct: 10 },
];

export function FailurePatterns() {
  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
      <div className="text-[13px] font-semibold text-txt mb-4">Failure Patterns</div>
      <div className="space-y-2">
        {FAILURE_DATA.map((fp) => (
          <div
            key={fp.gate}
            className="flex items-center gap-3 p-2.5 bg-void rounded-[5px] border border-bdr"
          >
            <span className="font-mono text-xs text-[#ef4444] font-semibold w-[100px] shrink-0">
              {fp.gate}
            </span>
            <span className="flex-1 text-xs text-txt-dim">{fp.description}</span>
            <span className="font-mono text-xs text-txt font-semibold w-10 text-right shrink-0">
              {fp.frequencyPct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
