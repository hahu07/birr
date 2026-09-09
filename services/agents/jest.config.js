/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  setupFiles: ["<rootDir>/../jest.setup.ts"],
  // rootDir is "src" above, matching apps/backend/jest.config.js's own
  // reasoning for why coverageDirectory needs to be pulled back out.
  coverageDirectory: "<rootDir>/../coverage",
};
