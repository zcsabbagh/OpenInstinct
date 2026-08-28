import { ManagerShell } from "@/app/_components/manager-shell";
import { WorkspaceManager } from "@/app/_components/manager/workspace";
import { requireRequestScope } from "@/app/_lib/server/request-scope";
import { syncGoogleCalendarTimezone } from "@/lib/google-workspace/calendar-timezone";
import { getGoogleWorkspaceConnection } from "@/lib/google-workspace/server";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<{ google?: string | string[] }>;
}) {
  const google = (await searchParams).google;
  const googleNotice = google === "unavailable" ? "unavailable" : undefined;

  // The user just finished connecting Google Workspace from this page (see
  // app/api/connectors/google/route.ts's `returnUrl`) - the best moment to
  // capture their Calendar timezone, since a session and a live connection
  // are both guaranteed right here. `/google-connected` (the Linq-driven
  // connect flow's callback) has neither reliably, so it isn't hooked the
  // same way; that flow instead picks up the timezone on the user's next
  // inbound message via the same gated sync in agent/channels/linq.ts.
  // Best-effort: a failure here just leaves that next message to fill it in.
  if (google === "connected") {
    try {
      const scope = await requireRequestScope();
      const connection = await getGoogleWorkspaceConnection(scope);
      await syncGoogleCalendarTimezone(scope, connection.state);
    } catch (error) {
      console.warn("[manager] calendar timezone sync failed:", error);
    }
  }

  return (
    <ManagerShell active="workspace">
      <WorkspaceManager googleNotice={googleNotice} />
    </ManagerShell>
  );
}
