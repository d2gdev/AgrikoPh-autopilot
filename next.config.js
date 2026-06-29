/** @type {import('next').NextConfig} */
const fs = require("fs");
const path = require("path");

// Don't throw at build time — SHOPIFY_STORE_DOMAIN may be provided only at runtime.
// Validate at request time in the headers() function instead.
if (!fs.existsSync(path.join(__dirname, "skills-source"))) {
  throw new Error("skills-source/ directory missing — skills will not be bundled");
}

const buildCpus = Number.parseInt(process.env.NEXT_BUILD_CPUS ?? "", 10);
const lintDuringBuild = process.env.NEXT_LINT_DURING_BUILD === "true";

const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Keep production builds focused on compilation. Run lint separately when needed.
    ignoreDuringBuilds: !lintDuringBuild,
  },
  typescript: {
    // Type errors are caught by `rtk tsc --noEmit` locally and in CI.
    // Skipping here prevents stale server-side .next/types from blocking prod builds.
    ignoreBuildErrors: true,
  },
  distDir: process.env.NEXT_OUTPUT_DIR || ".next",
  experimental: {
    ...(Number.isFinite(buildCpus) && buildCpus > 0 ? { cpus: buildCpus } : {}),
    ...(process.env.NEXT_MEMORY_BASED_WORKERS === "true" ? { memoryBasedWorkersCount: true } : {}),
  },
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/api/**": ["./skills-source/**"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "playwright"];
    }
    return config;
  },
  async headers() {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const shopDirective = shop ? ` https://${shop}` : "";
    return [
      {
        source: "/generated/article-images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors https://admin.shopify.com${shopDirective};`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
