import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Include public/templates files in serverless function bundles
  outputFileTracingIncludes: {
    "/api/listing-upload/inventory/export": ["./public/templates/**"],
  },
};

export default nextConfig;
