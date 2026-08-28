"use client";

import { useEffect } from "react";

// Mouse nags for the user's timezone because nothing ever learns it except a
// side effect of scheduling a reminder. The browser knows it exactly via
// Intl, so this reports it once per page load; `app/api/timezone/route.ts`
// resolves the workspace from the session and persists it. Mounted once in
// the root layout (not per-page) so it covers every authenticated page,
// including `/vault`, which is reachable without a session for link-preview
// crawlers - `enabled` comes from the server-resolved session so signed-out
// visits never even attempt the request.
export function TimezoneReporter({ enabled }: { readonly enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let timezone: string;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!timezone) return;

    void fetch("/api/timezone", {
      body: JSON.stringify({ timezone }),
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => {
      // Best-effort: the timezone note in chat just stays "not on file" and
      // the agent falls back to asking or to what the user states directly.
    });
  }, [enabled]);

  return null;
}
