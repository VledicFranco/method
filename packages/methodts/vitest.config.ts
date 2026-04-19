import { defineConfig } from "vitest/config";

// `experiment-*.test.ts` files are research harnesses that make real LLM
// calls (cost real money, multi-minute timeouts). They run via
// `npm run test:experiments`, never as part of the default suite.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.property.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/experiment-*.test.ts"],
    globals: true,
  },
});
