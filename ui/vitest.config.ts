import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const COVERAGE_INCLUDES = ["src/lib/movieDisplay.ts", "src/components/ConfirmDialog.tsx"] as const;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globals: false,
    restoreMocks: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [...COVERAGE_INCLUDES],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
