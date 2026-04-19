// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIXTURES,
  incidentTriageFixture,
  featureDevCommissionFixture,
  dailyReportFixture,
} from '../fixtures/index.js';

describe('G-FIXTURE-INTEGRITY — each canonical fixture is well-formed', () => {
  it('DEFAULT_FIXTURES contains the three canonical fixtures', () => {
    assert.equal(DEFAULT_FIXTURES.length, 3);
    const ids = DEFAULT_FIXTURES.map((f) => f.id);
    assert.deepEqual(ids, ['incident-triage', 'feature-dev-commission', 'daily-report']);
  });

  for (const fixture of DEFAULT_FIXTURES) {
    it(`[${fixture.id}] has valid pact, non-empty script, well-formed expectations`, () => {
      assert.ok(fixture.pact.mode, 'pact.mode required');
      assert.ok(fixture.request.prompt.length > 0, 'request.prompt non-empty');
      assert.ok(fixture.script.length >= 1, 'script non-empty');
      assert.ok(fixture.scriptedLlm.length >= 1, 'scriptedLlm non-empty');
      assert.ok(
        fixture.minimumExpectations.minAuditEvents >= 3,
        'minAuditEvents at least 3 (started/turn_complete/completed)',
      );
      assert.ok(
        fixture.minimumExpectations.requiredAuditKinds.includes('method.agent.started'),
        'requiredAuditKinds includes method.agent.started',
      );
      assert.ok(
        fixture.minimumExpectations.requiredAuditKinds.includes('method.agent.completed'),
        'requiredAuditKinds includes method.agent.completed',
      );
    });
  }

  it('incident-triage declares scope.allowedTools and expectsScopeCheck', () => {
    assert.deepEqual(
      incidentTriageFixture.pact.scope?.allowedTools,
      ['Grep', 'Read', 'Slack'],
    );
    assert.equal(incidentTriageFixture.minimumExpectations.expectsScopeCheck, true);
    assert.equal(incidentTriageFixture.minimumExpectations.expectsResume, false);
  });

  it('feature-dev-commission expects delegation and resume', () => {
    assert.equal(featureDevCommissionFixture.minimumExpectations.expectsDelegation, true);
    assert.equal(featureDevCommissionFixture.minimumExpectations.expectsResume, true);
    assert.ok(
      featureDevCommissionFixture.minimumExpectations.requiredAuditKinds.includes(
        'method.agent.suspended',
      ),
    );
    assert.ok(
      featureDevCommissionFixture.minimumExpectations.requiredAuditKinds.includes(
        'method.agent.resumed',
      ),
    );
  });

  it('daily-report has no tools and no delegation', () => {
    assert.equal(dailyReportFixture.pact.scope, undefined);
    assert.equal(dailyReportFixture.minimumExpectations.expectsDelegation, false);
    assert.equal(dailyReportFixture.minimumExpectations.expectsResume, false);
  });
});
