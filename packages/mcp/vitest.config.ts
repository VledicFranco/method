import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@fractal-co-design/fca-index/testkit': resolve(__dirname, '../fca-index/src/testkit/index.ts'),
      '@fractal-co-design/fca-index': resolve(__dirname, '../fca-index/src/index.ts'),
      '@methodts/methodts': resolve(__dirname, '../methodts/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
