import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts") } },
  test: { include: ["tests/e2e/**/*.test.ts"], environment: "node", testTimeout: 300_000, hookTimeout: 60_000, fileParallelism: false },
});
