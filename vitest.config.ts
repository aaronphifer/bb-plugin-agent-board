import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    pool: "threads",
    maxWorkers: 1, // Serial startup is reliable on the Windows development host.
    hookTimeout: 20_000, // Cold app imports include the existing large icon registry.
    deps: {
      // Compile the large data-only icon barrel once; keep real icons and hook limits.
      optimizer: { ssr: { enabled: true, include: ["@hugeicons/core-free-icons"] } },
    },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
