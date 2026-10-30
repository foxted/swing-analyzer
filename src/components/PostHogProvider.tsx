"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { useEffect } from "react";

/**
 * Boots PostHog once on the client. Events go through the /ingest rewrite in next.config.ts so
 * ad blockers do not drop them. Without a key (local dev without .env.local) nothing is sent.
 */
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      defaults: "2025-05-24",
      capture_exceptions: true,
    });
  }, []);

  return <Provider client={posthog}>{children}</Provider>;
}
