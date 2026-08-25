import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit `.next/standalone/server.js` — a self-contained server bundled with
  // only the node_modules it actually imports. Without this the runtime image
  // has to ship the whole dependency tree (~700 MB) just to run `next start`;
  // with it the final image is ~200 MB and needs no package manager at all.
  //
  // Required by apps/web/Dockerfile. Changing it breaks the image build.
  output: "standalone",

  // Playwright starts its own dev server (mocking set to "e2e") while your own
  // `pnpm dev` may already be running. Next refuses two dev servers that share a
  // build directory, so the E2E one gets its own via NEXT_DIST_DIR. Unset in
  // every other context, which leaves the default `.next` exactly as it was.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
