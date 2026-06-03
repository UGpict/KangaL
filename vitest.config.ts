import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // Load .env / .env.local so GOOGLE_CLOUD_PROJECT etc. are available to tests
    // without having to export them in every shell. Empty prefix = load all keys
    // (not just VITE_*).
    env: loadEnv("test", process.cwd(), ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
