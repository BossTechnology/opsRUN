import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // La imagen de producción (Dockerfile) corre .next/standalone/server.js:
  // solo lo que el build trazó, sin node_modules completos ni pnpm.
  output: "standalone",
};

export default nextConfig;
