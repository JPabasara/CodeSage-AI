import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",

  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  devIndicators: { position: "bottom-right" },
}

export default nextConfig
