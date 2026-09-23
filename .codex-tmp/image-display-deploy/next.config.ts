import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Include public/templates files in serverless function bundles
  outputFileTracingIncludes: {
    "/api/listing-upload/inventory/export": ["./public/templates/**"],
    "/api/listing-upload/variation-thumbnail": ["./assets/fonts/**"],
  },
  // Exclude transformers.js + ONNX from server bundles — it's client-only.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@huggingface/transformers/**",
      "node_modules/onnxruntime-web/**",
      "node_modules/onnxruntime-node/**",
      "node_modules/onnxruntime-common/**",
      "node_modules/sharp/vendor/**",
    ],
  },
  // Prevent the server bundler from following imports into transformers.js.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-web", "onnxruntime-node"],
};

export default nextConfig;
