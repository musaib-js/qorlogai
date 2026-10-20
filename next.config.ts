import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Heavy server-only libraries are loaded from node_modules instead of being bundled.
  serverExternalPackages: ["exceljs", "pdf-lib", "@googleapis/sheets", "google-auth-library", "bcryptjs"],
  experimental: {
    // Uploads go through /api/timesheets; keep under Vercel's 4.5MB request body limit.
    serverActions: { bodySizeLimit: "4mb" },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
