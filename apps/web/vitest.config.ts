import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Next preserves JSX for its own compiler; server-component unit tests need
  // Vite to transform it before Node imports the TSX module.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
