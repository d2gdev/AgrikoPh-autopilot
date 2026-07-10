import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals.js";
import nextTs from "eslint-config-next/typescript.js";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat();

export default defineConfig([
  ...compat.config(nextVitals.default ?? nextVitals),
  ...compat.config(nextTs.default ?? nextTs),
  {
    files: ["**/__tests__/**/*.ts", "**/__tests__/**/*.tsx", "lib/connectors/meta.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: [
      "next.config.js",
      "server.js",
      "scripts/*.mjs",
      "app/(embedded)/(dashboard)/dashboard/page.tsx",
      "app/(embedded)/(social-pilot)/social-pilot/page.tsx",
      "app/(embedded)/(ad-pilot)/ad-pilot/page.tsx",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "react/jsx-key": "off",
    },
  },
  {
    files: ["app/api/seo/gaps/promote/route.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
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
