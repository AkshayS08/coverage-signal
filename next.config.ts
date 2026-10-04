import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home folder (in use by other tools there)
  // made Turbopack pick C:\Users\16176 as the root, and every /api route 404'd
  // under `next dev`. The project root is this directory, stated rather than
  // inferred.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
