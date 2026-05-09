import type { NextConfig } from "next";
import path from "path";

// N2 (2026-05-09): turbopack.root 명시 — 상위 Logos/ 의 package-lock.json
// 으로 인해 잘못된 workspace root 감지 + 404 회피.
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
