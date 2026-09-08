// Shared flat-config base, imported by each workspace's own
// eslint.config.mjs (kept per-package, not one root config scoped by
// glob, so `eslint .` run from inside any package — what each
// package.json's own `lint` script does, and what turbo's `lint` task
// already expects — resolves a config relative to its own cwd without
// having to know about siblings). This file just holds what every
// workspace agrees on; package-specific additions (Next's rules for
// apps/web, type-aware no-floating-promises for apps/backend) live in
// that package's own config.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/.turbo/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      // This codebase's own convention (see e.g.
      // GovernedActionsService.propose()'s "Deliberately NOT awaited"
      // comments) is a leading underscore for a value that's genuinely
      // unused, not an accident — matches typescript-eslint's own
      // documented escape hatch for this rule.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // First lint run (2026-09-08) surfaced ~160 of these, mostly
      // Prisma before/after audit-log snapshots and payloads that are
      // genuinely dynamic by design (see AuditLog.before/after's own
      // Json? typing) — not a pattern this pass can respecify without
      // touching that much of the codebase for no behavioral change.
      // Warn keeps it visible without blocking on existing code; new
      // `any` usage still shows up in a diff/review.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
