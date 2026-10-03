import { defineConfig, defaultExclude } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Native tsconfig-paths resolution (Vite's own option) resolves the
  // "@/*" alias tsconfig.json already declares — no separate plugin
  // needed for it.
  resolve: { tsconfigPaths: true },
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    // Vitest's own default include glob (**/*.spec.ts) otherwise also
    // picks up e2e/*.spec.ts — Playwright specs, run by `pnpm e2e`, not
    // this suite; each one imports `test`/`expect` from @playwright/test,
    // not this file's vitest globals, so vitest can't run them anyway.
    exclude: [...defaultExclude, "e2e/**"],
  },
});
