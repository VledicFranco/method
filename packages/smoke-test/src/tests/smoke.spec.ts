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
  test('loads the UI and displays test cases', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Methodology Smoke Tests' })).toBeVisible();

    // Sidebar should have cases
    await expect(page.locator('.case-item').first()).toBeVisible();
    const caseCount = await page.locator('.case-item').count();
    expect(caseCount).toBeGreaterThan(20);
  });

  test('can select and run a single test case', async ({ page }) => {
    await page.goto('/');

    // Click on the first strategy case
    await page.locator('.case-item').first().click();

    // Should show case detail
    await expect(page.locator('.case-header h2')).toBeVisible();

    // Click Run
    await page.getByRole('button', { name: 'Run' }).click();

    // Wait for result
    await expect(page.locator('.status-banner')).toBeVisible({ timeout: 30_000 });

    // Should show assertions
    const assertionCount = await page.locator('.assertion').count();
    expect(assertionCount).toBeGreaterThan(0);
  });

  test('filter narrows the case list', async ({ page }) => {
    await page.goto('/');
    const initialCount = await page.locator('.case-item').count();

    await page.getByPlaceholder('Filter').fill('gate');
    const filteredCount = await page.locator('.case-item').count();

    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });
});
