import { test, expect } from '@playwright/test';

test('dashboard /', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tests/screenshots/dashboard.png', fullPage: true });

  await expect(page.locator('.app-nav')).toBeVisible();
  await expect(page.locator('.dashboard-header h1')).toContainText('Mission Control');
  await expect(page.locator('.error')).toHaveCount(0);
});

test('methodologies list /methodologies', async ({ page }) => {
  await page.goto('/methodologies');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tests/screenshots/methodologies.png', fullPage: true });

  await expect(page.locator('.app-nav')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Methodologies');
  await expect(page.locator('.error')).toHaveCount(0);
});

test('methodology detail /methodologies/method-iteration', async ({ page }) => {
  await page.goto('/methodologies/method-iteration');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tests/screenshots/methodology-detail.png', fullPage: true });

  await expect(page.locator('.app-nav')).toBeVisible();
  await expect(page.locator('.method-split-graph')).toBeVisible();
  await expect(page.locator('.method-split-phases')).toBeVisible();
  await expect(page.locator('.error')).toHaveCount(0);
});

test('sessions /sessions', async ({ page }) => {
  await page.goto('/sessions');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tests/screenshots/sessions.png', fullPage: true });

  await expect(page.locator('.app-nav')).toBeVisible();
  await expect(page.locator('.error')).toHaveCount(0);
});

test('projects /projects', async ({ page }) => {
  await page.goto('/projects');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tests/screenshots/projects.png', fullPage: true });

  await expect(page.locator('.app-nav')).toBeVisible();
  await expect(page.locator('.error')).toHaveCount(0);
});
