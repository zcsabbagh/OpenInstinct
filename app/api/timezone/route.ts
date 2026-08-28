import { z } from "zod";
import {
  requireRequestScope,
  UnauthenticatedError,
  unauthorizedResponse,
} from "@/app/_lib/server/request-scope";
import { isAllowedMutationOrigin } from "@/lib/manager";
import { isValidTimeZone } from "@/lib/schedule-time";
import { getUserTimezone, setUserTimezone } from "@/lib/user-prefs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const timezoneReportSchema = z.object({ timezone: z.string().min(1) });

// The browser knows the user's timezone exactly (Intl.DateTimeFormat), so
// `app/_components/timezone-reporter.tsx` reports it once per page load and
// this persists it. `/vault` is reachable without a session (proxy.ts opens
// it up for cookieless link-preview crawlers), so this must resolve the
// workspace from the authenticated session and no-op for anyone without
// one - it never accepts or trusts a caller-supplied workspace id.
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
    const current = await getUserTimezone(scope.workspaceId);
    if (current !== timezone) {
      await setUserTimezone(scope.workspaceId, timezone);
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
