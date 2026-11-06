import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// After each test, unmount what it rendered and restore the real fetch.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
