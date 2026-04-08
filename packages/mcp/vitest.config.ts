import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@method/fca-index/testkit': resolve(__dirname, '../fca-index/src/testkit/index.ts'),
      '@method/fca-index': resolve(__dirname, '../fca-index/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
