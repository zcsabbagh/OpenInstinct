import { z } from "zod";
import { accessScopeForUser } from "@/lib/access-scope";
import { claimOnce } from "@/lib/durable-state";
import { env } from "@/lib/env";
import { getGoogleWorkspaceConnection } from "@/lib/google-workspace/server";
import { loadDurableLinqTarget, type LinqJobOwner } from "@/lib/linq-target";

// The browser lands here right after Google Workspace finishes connecting -
// both from the Linq-driven onboarding flow (agent/channels/linq.ts) and the
// authenticated web portal flow (app/api/connectors/google/route.ts) - on its
// way to the actual confirmation page. Neither of those source pages has a
// place to invoke eve's cross-channel hand-off directly: `ctx.to(...)` only
// exists inside authored eve runtime code (a route, schedule, or hook), never
// inside a plain Next.js page or route handler. Routing the OAuth callback
// through this one eve channel route is what makes the hand-off reachable
// from both flows, including /google-connected, which is deliberately public
// and has no reliable session (see app/google-connected/page.tsx and
// proxy.ts).
export const GOOGLE_CONNECT_NOTIFY_PATH = "/internal/google-connect-notify";

const googleConnectNotifyDestSchema = z.enum(["google-connected", "portal"]);
export type GoogleConnectNotifyDest = z.infer<
  typeof googleConnectNotifyDestSchema
>;

// A fixed two-value enum instead of an arbitrary `next` URL: the redirect
// target is never attacker-controlled, so there is no open-redirect surface
// to validate.
const DEST_PATHS: Record<GoogleConnectNotifyDest, string> = {
  "google-connected": "/google-connected",
  portal: "/?google=connected",
};

/**
 * Builds the callback URL passed to `startGoogleWorkspaceAuthorization` so
 * the OAuth return trip notifies `workspaceId`'s Linq thread before landing
 * on `dest` (default: the Linq flow's /google-connected page).
 */
export function buildGoogleConnectNotifyUrl(
  workspaceId: string,
  dest: GoogleConnectNotifyDest = "google-connected"
): URL {
  const url = new URL(GOOGLE_CONNECT_NOTIFY_PATH, env.BETTER_AUTH_URL);
  url.searchParams.set("w", workspaceId);
  if (dest !== "google-connected") url.searchParams.set("dest", dest);
  return url;
}

/** Resolves the `dest` query param to its redirect target, defaulting safely. */
export function resolveGoogleConnectNotifyDestination(
  destParam: string | null
): URL {
  const parsed = googleConnectNotifyDestSchema.safeParse(destParam);
  const dest = parsed.success ? parsed.data : "google-connected";
  return new URL(DEST_PATHS[dest], env.BETTER_AUTH_URL);
}

export type GoogleConnectNotifyOutcome =
  | { status: "sent"; target: LinqJobOwner }
  | { status: "no-target" }
  | { status: "not-connected" }
  | { status: "already-notified" };

/**
 * Decides whether Google connecting for `workspaceId` should trigger the
 * proactive "we're in" message, without performing the actual cross-channel
 * send - that needs the live eve `ctx.to()`, only available inside the
 * authored route handler that calls this. Idempotent per workspace (not per
 * callback hit or per token): claims a `channel_state` row via `claimOnce`
 * before returning "sent", so a refreshed callback page, a second Google
 * connect, or a retried redirect never sends the message twice.
 *
 * Re-verifies the connection through `getGoogleWorkspaceConnection` rather
 * than trusting the callback alone, so a guessed or replayed workspace id in
 * the `w` query param cannot fabricate a "we're in" message for a workspace
 * that never actually connected.
 */
export async function resolveGoogleConnectNotify(
  workspaceId: string
): Promise<GoogleConnectNotifyOutcome> {
  const target = await loadDurableLinqTarget(workspaceId);
  if (!target) return { status: "no-target" };

  const scope = accessScopeForUser(target.ownerPrincipalId);
  if (scope.workspaceId !== workspaceId) return { status: "no-target" };

  const connection = await getGoogleWorkspaceConnection(scope);
  if (connection.state !== "connected") return { status: "not-connected" };

  const claimed = await claimOnce("google-connect-notified", workspaceId);
  if (!claimed) return { status: "already-notified" };

  return { status: "sent", target };
}
