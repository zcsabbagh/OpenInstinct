import { z } from "zod";
import {
  requireRequestScope,
  UnauthenticatedError,
  unauthorizedResponse,
} from "@/app/_lib/server/request-scope";
import { isAllowedMutationOrigin } from "@/lib/manager";
import { isValidTimeZone } from "@/lib/schedule-time";
import {
  getUserTimezonePref,
  setUserTimezoneFromSource,
} from "@/lib/user-prefs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const timezoneReportSchema = z.object({ timezone: z.string().min(1) });

// The browser knows the user's timezone exactly (Intl.DateTimeFormat), so
// `app/_components/timezone-reporter.tsx` reports it once per page load and
// this persists it. `/vault` is reachable without a session (proxy.ts opens
// it up for cookieless link-preview crawlers), so this must resolve the
// workspace from the authenticated session and no-op for anyone without
// one - it never accepts or trusts a caller-supplied workspace id.
//
// The browser is the lowest-ranked timezone source (see
// lib/user-prefs.ts): it reports the device's *current* zone, which is wrong
// while travelling, so it is written with source "browser" and
// `setUserTimezoneFromSource` will refuse to let it clobber a Google
// Calendar sync or an explicit set_timezone already on file.
export async function POST(request: Request) {
  try {
    const scope = await requireRequestScope();
    if (!isAllowedMutationOrigin(originCheckInput(request))) {
      return Response.json(
        { error: "Cross-origin request blocked." },
        { status: 403 }
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = timezoneReportSchema.safeParse(body);
    if (!parsed.success || !isValidTimeZone(parsed.data.timezone)) {
      return Response.json({ error: "Invalid timezone." }, { status: 400 });
    }

    const { timezone } = parsed.data;
    const current = await getUserTimezonePref(scope.workspaceId);
    if (current?.timezone !== timezone) {
      // Lowest-ranked source (see lib/user-prefs.ts): this is a no-op when a
      // Google Calendar sync or an explicit set_timezone already outranks it.
      await setUserTimezoneFromSource(scope.workspaceId, timezone, "browser");
    }

    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthenticatedError) return unauthorizedResponse();
    return Response.json(
      { error: "Timezone request failed." },
      { status: 400 }
    );
  }
}

function originCheckInput(request: Request) {
  return {
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    requestUrl: request.url,
  };
}
