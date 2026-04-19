// SPDX-License-Identifier: Apache-2.0
/**
 * Playwright smoke tests — automated browser verification of all test cases.
 *
 * Starts the smoke test server, navigates to the UI, runs each mock-mode
 * test case, and verifies all assertions pass.
 *
 * Run: npx playwright test (from packages/smoke-test/)
 * Or:  npm run smoke (from repo root)
 */

import { test, expect } from '@playwright/test';

test.describe('Smoke test suite: run-all endpoint', () => {
  test('all mock-mode test cases pass via /api/run-all', async ({ request }) => {
    const response = await request.get('/api/cases');
    expect(response.ok()).toBe(true);
    const { cases } = await response.json();
    const mockCases = cases.filter((c: { mode: string }) => c.mode !== 'live');

    expect(mockCases.length).toBeGreaterThan(20);

    // Run each mock case individually and check assertions
    const results: Array<{ id: string; passed: boolean; error?: string }> = [];

    for (const tc of mockCases) {
      const res = await request.get(`/api/run/${tc.id}`);
      expect(res.ok()).toBe(true);
      const text = await res.text();
      // Parse SSE events
      const events = text.split('\n\n')
        .filter((chunk: string) => chunk.startsWith('data: '))
        .map((chunk: string) => JSON.parse(chunk.slice(6)));

      const completed = events.find(
        (e: { type: string }) => e.type === 'case_completed' || e.type === 'case_failed',
      );

      if (!completed) {
        results.push({ id: tc.id, passed: false, error: 'No completion event' });
        continue;
      }

      results.push({
        id: tc.id,
        passed: completed.allPassed === true,
        error: completed.error ?? (
          completed.assertions
            ?.filter((a: { passed: boolean }) => !a.passed)
            .map((a: { name: string; expected: string; actual: string }) => `${a.name}: expected ${a.expected}, got ${a.actual}`)
            .join('; ')
        ),
      });
    }

    // Report
    const passed = results.filter((r) => r.passed);
    const failed = results.filter((r) => !r.passed);

    if (failed.length > 0) {
      const report = failed.map((r) => `  ${r.id}: ${r.error}`).join('\n');
      console.log(`\nPassed: ${passed.length}/${results.length}`);
      console.log(`Failed:\n${report}`);
    }

    expect(failed, `${failed.length} test cases failed:\n${failed.map(r => `  ${r.id}: ${r.error}`).join('\n')}`).toHaveLength(0);
  });
});

test.describe('Smoke test suite: browser UI', () => {
  // ─────────────────────────────────────────────────────────────
  // Layer Stack (/#/layers — default route)
  // ─────────────────────────────────────────────────────────────
  test('layer stack: top nav + brand + nav links + Run All button are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header.top-nav .brand')).toHaveText('Methodology Smoke Tests');
    await expect(page.locator('.top-nav .nav-links a[data-route="layers"]')).toBeVisible();
    await expect(page.locator('.top-nav .nav-links a[data-route="features"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run All (mock)' })).toBeVisible();
  });

  test('layer stack: renders 4 layer rows split across two-stack model with coverage counts', async ({ page }) => {
    await page.goto('/');

    // Orchestration stack holds Strategy
    const orchRows = page.locator('.orchestration-stack .layer-row');
    await expect(orchRows).toHaveCount(1);
    await expect(orchRows.nth(0)).toHaveClass(/strategy/);

    // Session stack holds Methodology → Method → Agent (in that vertical order)
    const sessRows = page.locator('.session-stack .layer-row');
    await expect(sessRows).toHaveCount(3);
    await expect(sessRows.nth(0)).toHaveClass(/methodology/);
    await expect(sessRows.nth(1)).toHaveClass(/method/);
    await expect(sessRows.nth(2)).toHaveClass(/agent/);

    // Each row exposes a coverage count ("N/M features tested")
    const allRows = page.locator('.layer-stacks-two-col .layer-row');
    await expect(allRows).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(allRows.nth(i).locator('.lcount')).toContainText(/\d+\/\d+ features tested/);
    }
  });

  test('layer stack: two-stack composition — session arrows + bridge + self-loop', async ({ page }) => {
    await page.goto('/');
    // Session stack has 2 composition arrows: methodology → method, method → agent
    const sessionArrows = page.locator('.session-stack .comp-arrow');
    await expect(sessionArrows).toHaveCount(2);
    await expect(sessionArrows.nth(0)).toHaveAttribute('aria-label', /selects/i);
    await expect(sessionArrows.nth(1)).toHaveAttribute('aria-label', /orders|invoke/i);

    // Orchestration stack has a self-loop (strategy → sub-strategy recursion)
    await expect(page.locator('.orchestration-stack .self-loop')).toHaveCount(1);

    // Bridge arrow hands off from Strategy to Methodology (orchestration → session)
    const bridge = page.locator('.bridge-arrow');
    await expect(bridge).toHaveCount(1);
    await expect(bridge).toHaveAttribute('aria-label', /methodology session/i);
  });

  test('layer stack: per-layer documentation sections render narrative + concept pills + lifecycle pills', async ({ page }) => {
    await page.goto('/');
    const docs = page.locator('.layer-docs .layer-doc');
    await expect(docs).toHaveCount(4);
    // Spot-check methodology doc for narrative + pill groups
    const methDoc = page.locator('#layer-doc-methodology');
    await expect(methDoc).toBeVisible();
    await expect(methDoc.locator('.narrative')).not.toBeEmpty();
    await expect(methDoc.locator('.lifecycle-pills .lifecycle-pill').first()).toBeVisible();
    await expect(methDoc.locator('.concept-pills .concept-pill').first()).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────
  // Feature Map (/#/features)
  // ─────────────────────────────────────────────────────────────
  test('feature map: navigate via nav link, render cluster sections ordered by layer', async ({ page }) => {
    await page.goto('/');
    await page.locator('.top-nav .nav-links a[data-route="features"]').click();
    await expect(page).toHaveURL(/#\/features$/);

    await expect(page.locator('.feature-map-view h2')).toHaveText('Feature Map');

    const clusters = page.locator('.feature-map-view .cluster');
    const clusterCount = await clusters.count();
    expect(clusterCount).toBeGreaterThan(0);

    // Each cluster header has a layer badge + title + count
    await expect(clusters.first().locator('.cluster-header .cluster-title')).toBeVisible();
    await expect(clusters.first().locator('.cluster-header .cluster-count')).toContainText(/\d+\/\d+ covered/);

    // Layer ordering: first cluster is methodology, last is agent
    await expect(clusters.first()).toHaveClass(/methodology/);
    await expect(clusters.last()).toHaveClass(/agent/);
  });

  test('feature map: renders at least 30 feature tiles and supports click-through', async ({ page }) => {
    await page.goto('/#/features');

    const tiles = page.locator('.feature-map-view .feature-tile');
    await expect(tiles.first()).toBeVisible();
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThanOrEqual(30);

    // Click the known covered strategy feature by its data-feature-id
    await page.locator('.feature-tile[data-feature-id="methodology-node"]').click();
    await expect(page).toHaveURL(/#\/feature\/methodology-node$/);
    await expect(page.locator('.feature-detail-view')).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────
  // Feature Detail (/#/feature/:id)
  // ─────────────────────────────────────────────────────────────
  test('feature detail (strategy): narrative + case card + Run triggers DAG SVG render', async ({ page }) => {
    await page.goto('/#/feature/methodology-node');

    const view = page.locator('.feature-detail-view');
    await expect(view).toBeVisible();
    await expect(view.locator('.fd-title')).toBeVisible();
    await expect(view.locator('.fd-narrative')).not.toBeEmpty();

    const caseBlock = view.locator('.fd-case-block').first();
    await expect(caseBlock).toBeVisible();
    await expect(caseBlock.locator('.case-card')).toBeVisible();

    // Pre-run: placeholder prompt to click Run
    await expect(caseBlock.locator('.fd-dag-placeholder')).toBeVisible();

    // Click the Run button inside the first covering case card
    await caseBlock.locator('.case-run-btn').click();

    // Wait for terminal status pill (PASS or FAIL) — SSE completion
    await expect(caseBlock.locator('.case-card-status.pass, .case-card-status.fail')).toBeVisible({ timeout: 30_000 });

    // DAG SVG rendered with at least one node rect (don't over-specify layout)
    await expect(caseBlock.locator('svg.dag-svg')).toBeVisible();
    const nodeRects = caseBlock.locator('svg.dag-svg .dag-node rect');
    expect(await nodeRects.count()).toBeGreaterThan(0);

    // Assertion list populated
    const assertions = caseBlock.locator('.assertions .assertion');
    expect(await assertions.count()).toBeGreaterThan(0);
  });

  test('feature detail (method): narrative loads, no DAG SVG, step-list fallback present', async ({ page }) => {
    await page.goto('/#/feature/step-current');

    const view = page.locator('.feature-detail-view');
    await expect(view).toBeVisible();
    await expect(view.locator('.fd-title')).toBeVisible();
    await expect(view.locator('.fd-narrative')).not.toBeEmpty();

    const caseBlock = view.locator('.fd-case-block').first();
    await expect(caseBlock).toBeVisible();
    // Idle state for non-strategy layers: step-list fallback line is visible
    await expect(caseBlock.locator('.fd-step-fallback')).toBeVisible();
    // No DAG rendered at idle for method-layer features
    await expect(caseBlock.locator('svg.dag-svg')).toHaveCount(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Run All panel
  // ─────────────────────────────────────────────────────────────
  test('run all: clicking the button reveals the panel with aggregate counts', async ({ page }) => {
    await page.goto('/');

    const panel = page.locator('#run-all-panel');
    await expect(panel).toBeHidden();

    await page.getByRole('button', { name: 'Run All (mock)' }).click();

    // Panel becomes visible
    await expect(panel).toBeVisible();
    await expect(panel.locator('.rap-title')).toHaveText('Run All');

    // Total count resolves to a positive number shortly after the run starts
    const totalEl = panel.locator('[data-c="total"]');
    await expect(totalEl).not.toHaveText('0', { timeout: 15_000 });

    // Close button hides panel again — keeps test independent
    await panel.locator('#run-all-close').click();
    await expect(panel).toBeHidden();
  });
});
