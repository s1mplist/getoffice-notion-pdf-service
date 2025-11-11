import type { NextConfig } from "next";

const nextConfig: NextConfig = {
// v15 made this property stable
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
};

export default nextConfig;