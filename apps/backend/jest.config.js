/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  // Transpile-only; see tsconfig.spec.json for why.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.spec.json" }],
  },
  testEnvironment: "node",
  // Jest's default (cores - 1 workers, 7 on an 8-core laptop) let the
  // ts-jest workers grow past the machine's RAM, and Ubuntu's systemd-oomd
  // killed VS Code mid-run (2026-11-16: 12.8 GB peak). Three workers, each
  // recycled once it holds more than 1 GB, keep a full run within memory.
  maxWorkers: 3,
  workerIdleMemoryLimit: "1GB",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  setupFiles: ["<rootDir>/../jest.setup.ts"],
  // Suspends the staff fixtures each run creates; see jest.global-teardown.ts.
  globalSetup: "<rootDir>/../jest.global-setup.ts",
  globalTeardown: "<rootDir>/../jest.global-teardown.ts",
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
