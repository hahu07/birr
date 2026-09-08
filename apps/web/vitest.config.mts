import { defineConfig } from "vitest/config";
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
  },
});
