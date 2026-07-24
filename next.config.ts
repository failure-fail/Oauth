import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // OpenAI clients use baseURL .../v1 — map onto App Router API routes.
    return [
      { source: "/v1/:path*", destination: "/api/v1/:path*" },
    ];
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
