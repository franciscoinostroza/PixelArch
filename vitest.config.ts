import { defineConfig } from "vitest/config"
import path from "path"
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
