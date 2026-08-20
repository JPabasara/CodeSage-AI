import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit `.next/standalone/server.js` — a self-contained server bundled with
  // only the node_modules it actually imports. Without this the runtime image
  // has to ship the whole dependency tree (~700 MB) just to run `next start`;
  // with it the final image is ~200 MB and needs no package manager at all.
  //
  // Required by apps/web/Dockerfile. Changing it breaks the image build.
  output: "standalone",
};

export default nextConfig;
