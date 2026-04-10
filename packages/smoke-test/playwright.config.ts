import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/tests',
  testMatch: 'smoke.spec.ts',
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${process.env.SMOKE_PORT ?? 5180}`,
  },
  webServer: {
    command: 'npx tsx src/server.ts',
    port: Number(process.env.SMOKE_PORT ?? 5180),
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
