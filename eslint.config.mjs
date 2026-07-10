import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals.js";
import nextTs from "eslint-config-next/typescript.js";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat();

export default defineConfig([
  ...compat.config(nextVitals.default ?? nextVitals),
  ...compat.config(nextTs.default ?? nextTs),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "react/jsx-key": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next.build/**",
    ".next.new/**",
    "coverage/**",
    "node_modules/**",
    "out/**",
    "tmp/**",
    "next-env.d.ts",
  ]),
]);
