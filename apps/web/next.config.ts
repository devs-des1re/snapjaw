import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Produces a self-contained server bundle so the runtime image does not need
  // the full dependency tree. See apps/web/Dockerfile.
  output: "standalone",
};

export default nextConfig;
