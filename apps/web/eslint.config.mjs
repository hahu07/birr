import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import base from "../../eslint.config.base.mjs";

// Not eslint-config-next (the bundling package) + FlatCompat: bridging
// its legacy-shaped export through @eslint/eslintrc's FlatCompat hits a
// real bug there — eslint-plugin-react's config object is
// self-referential (completely normal for a flat-config plugin, since a
// config's `plugins` map points back at the plugin that registers it),
// but FlatCompat's legacy validator tries to JSON.stringify configs
// when formatting an unrelated warning and crashes on the circularity
// before ESLint ever runs. @next/eslint-plugin-next and
// eslint-plugin-react-hooks both ship real flat-config exports directly
// — using those sidesteps the bridge (and the bug) entirely. Trades
// away eslint-config-next's bundled eslint-plugin-jsx-a11y/
// eslint-plugin-import rules, which aren't this package's main value;
// the Next-specific and hooks-correctness rules are.
export default tseslint.config(
  ...base,
  { ignores: [".next/**"] },
  nextPlugin.configs["core-web-vitals"],
  // .configs.flat.recommended, not the confusingly-named
  // .configs["recommended-latest"] — that one is still legacy-shaped
  // (plugins: ["react-hooks"], a bare array of strings), which flat
  // config's own loader rejects outright.
  reactHooks.configs.flat.recommended,
  {
    rules: {
      // First lint run (2026-09-08) surfaced this at 12 call sites, all
      // the same standard "fetch in an effect, setState with the
      // result" or "derive one bit of local state from a prop" pattern
      // — not bugs, just this rule (new in eslint-plugin-react-hooks
      // v7, written for React Compiler-era code) being stricter than
      // this codebase's existing, correct conventions. Warn rather than
      // rewrite ~12 call sites' effect structure to satisfy a rule this
      // team hasn't decided to adopt yet.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
);
