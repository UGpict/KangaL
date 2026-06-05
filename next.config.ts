import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a minimal server.js so the Docker image can run
  // without a full node_modules install (Cloud Run container stays lean).
  output: "standalone",
};

export default nextConfig;
