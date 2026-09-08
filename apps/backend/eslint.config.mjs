import tseslint from "typescript-eslint";
import base from "../../eslint.config.base.mjs";

export default tseslint.config(
  ...base,
  { ignores: ["dist/**"] },
  {
    // Scoped to src/** specifically (not jest.setup.ts, jest.config.js
    // at this package's root) — tsconfig.json's own "include" is just
    // "src", so a type-aware rule (parserOptions.project below) has no
    // program to check anything outside that against.
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-aware, so it needs the parserOptions.project above. This
      // codebase's fire-and-forget-vs-awaited split is a deliberate,
      // load-bearing pattern (see distributions.service.ts's and
      // governed-actions.service.ts's own comments on exactly this) —
      // a dropped `await` here is a real bug class, not a style nit.
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
