import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest's `globals` is deliberately off (test files import
// describe/test/expect explicitly rather than relying on ambient
// globals) — Testing Library's own auto-cleanup only self-registers
// when it detects a global afterEach, so it has to be wired by hand
// here instead. Without this, each test's render() stacks a fresh copy
// of the page into the same jsdom document rather than replacing the
// last one.
afterEach(() => {
  cleanup();
});
