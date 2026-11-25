import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Every CRM screen depends on the signed-in user, so "instant navigation"
  // hints only add noise. Opt in per segment with `export const instant`.
  experimental: {
    instantInsights: { validationLevel: "manual-warning" },
    // CSV imports are sent to a server action.
    serverActions: { bodySizeLimit: "6mb" },
  },
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
