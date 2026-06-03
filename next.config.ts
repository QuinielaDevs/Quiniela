import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  // Permite que las pruebas E2E (Playwright) accedan al dev server vía 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
