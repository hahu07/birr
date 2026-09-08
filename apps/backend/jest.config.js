/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  setupFiles: ["<rootDir>/../jest.setup.ts"],
  // rootDir is "src" above, so the default coverageDirectory would
  // otherwise land inside src/ itself.
  coverageDirectory: "<rootDir>/../coverage",
  // A real regression floor, not an invented target — measured directly
  // (2026-09-08: 82.74% stmts / 61.51% branches / 71.91% funcs / 83.68%
  // lines) via `pnpm test -- --coverage`, then set a few points below
  // each to absorb normal fluctuation without being a no-op. Ratchet
  // these up as coverage genuinely improves; don't lower them to make a
  // failing PR pass.
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 58,
      functions: 68,
      lines: 81,
    },
  },
};
