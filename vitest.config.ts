import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [
      "node_modules/**",
      ".next/**",
      ".next.new/**",
      ".claude/**",
      ".serena/**",
      "tmp/**",
    ],
    coverage: {
      provider: "v8",
      include: ["lib/**", "jobs/**"], // app/api excluded — requires Next.js module system
      exclude: ["**/*.test.ts", "**/*.spec.ts", "node_modules/**", ".claude/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
