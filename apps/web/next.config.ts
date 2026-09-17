import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone bundle keeps the runtime image free of the full dependency tree (see apps/web/Dockerfile).
  output: "standalone",
};

export default nextConfig;
