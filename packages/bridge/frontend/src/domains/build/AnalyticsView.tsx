/**
 * AnalyticsView — Cross-build analytics tab content.
 *
 * Four sections: phase bottleneck chart, failure patterns,
 * refinement list with filters, and cost trend sparkline.
 *
 * @see PRD 047 §Dashboard Architecture — Analytics Tab
 */

import { PhaseBottleneckChart } from './PhaseBottleneckChart';
import { FailurePatterns } from './FailurePatterns';
import { RefinementList } from './RefinementList';
import { CostTrend } from './CostTrend';

export function AnalyticsView() {
  return (
    <div>
      <PhaseBottleneckChart />
      <FailurePatterns />
      <RefinementList />
      <CostTrend />
    </div>
  );
}
