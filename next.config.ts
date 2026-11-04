import type { NextConfig } from "next";

// Using the app from a phone over Tailscale: allow this tailnet's machine names (set TAILNET_DOMAIN, e.g. "my-tailnet.ts.net").
const tailnetHosts = process.env.TAILNET_DOMAIN ? [`*.${process.env.TAILNET_DOMAIN}`] : [];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: tailnetHosts,
  // The encoder (receipt matching) runs a model through native code; keep it out of the bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  // That runtime is 287 MB and a Vercel function can hold 250 MB, so a Vercel build leaves it out and the encoder is skipped there.
  ...(process.env.VERCEL ? { outputFileTracingExcludes: { "*": ["node_modules/onnxruntime-node/**", "node_modules/onnxruntime-web/**", "node_modules/@huggingface/transformers/**"] } } : {}),
  experimental: {
    // Receipt photos are shrunk in the browser to ~3 MB; the default limit is 1 MB.
    serverActions: { bodySizeLimit: "4mb", allowedOrigins: tailnetHosts },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
