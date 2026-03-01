import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:47820',
    screenshot: 'on',
  },
  reporter: [['html', { outputFolder: 'playwright-report' }]],
});
