import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Reuse a single worker across all test files instead of spawning one per file.
    // This removes the "4 workers spawned" startup warning and saves ~3 s on a cold run.
    isolate: false,
  },
});
