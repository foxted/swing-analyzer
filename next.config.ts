import type { NextConfig } from "next";

const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const posthogAssets = posthogHost.replace(/:\/\/(\w+)\.i\./, "://$1-assets.i.");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PostHog reverse proxy: the browser talks to /ingest on our own domain.
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `${posthogAssets}/static/:path*` },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
