import { defineChannel, GET } from "eve/channels";
import {
  GOOGLE_CONNECT_NOTIFY_PATH,
  resolveGoogleConnectNotify,
  resolveGoogleConnectNotifyDestination,
} from "@/lib/google-connect-notify";
import { buildJobAuth, buildLinqReceiveTarget } from "@/lib/linq-target";
import linq from "./linq";

// The message hand-off itself follows the same pattern as
// agent/schedules/dynamic.ts: give the model a fresh session and a prompt
// with real facts to go find, rather than sending a hardcoded string. See
// lib/google-connect-notify.ts for why this callback hop exists and how its
// idempotency and re-verification work.
const NOTIFY_PROMPT = [
  "Google Workspace (Gmail and Calendar) just finished connecting for this user. Send them a short proactive message opening the conversation - they have not said anything yet, so do not open with a question.",
  'Before writing anything, call google_workspace_read to find out what is actually true. Search Gmail for unread mail from the last week (for example "is:unread newer_than:7d") and separately for unread promotions (for example "is:unread category:promotions newer_than:7d"). Count only what the tool actually returns - never invent, estimate, or round a number. If a result looks capped by the search limit, say "more than N" instead of a precise total, or narrow the query further until the count is exact.',
  'Lead with the realest, most useful fact you found - a real unread count, a real promotions count you could clear, or, if mail is quiet, that plainly, pivoting to a different concrete offer like checking today\'s calendar or setting up a recurring digest. Never end on a vague "let me know if you need anything" - always name the specific next thing you could do right now.',
  "Keep it to one or two short lines, in your normal voice. Something in the shape of: \"we're in - i can see your calendar and inbox now. you've got 47 unread from this week, 12 of them promotions. want me to clear those?\" Do not copy that line or its numbers - every number you say must come from a tool call you actually made this turn. Use a spaced hyphen ( - ), never an em dash or en dash.",
].join("\n\n");

export default defineChannel({
  routes: [
    GET(GOOGLE_CONNECT_NOTIFY_PATH, async (request, { to, waitUntil }) => {
      const url = new URL(request.url);
      const workspaceId = url.searchParams.get("w");
      const redirectTo = resolveGoogleConnectNotifyDestination(
        url.searchParams.get("dest")
      );

      // Never block the OAuth redirect on the agent turn: the user is
      // mid-flow waiting to see the confirmation page. The notify itself
      // (a full model turn that reads Gmail and Calendar) runs after the
      // redirect is already on the wire.
      if (workspaceId) {
        waitUntil(
          (async () => {
            try {
              const outcome = await resolveGoogleConnectNotify(workspaceId);
              if (outcome.status === "no-target") {
                // Connected, but this workspace has never sent an inbound
                // Linq message, so there is no thread to text back into -
                // a user who connected Google before ever texting Mouse.
                // Not a crash, not silent: logged, and /google-connected
                // still offers its "Back to Mouse" button as the fallback.
                console.warn(
                  `[google-connect-notify] no delivery target on file for workspace ${workspaceId}`
                );
                return;
              }
              if (outcome.status !== "sent") return;

              await to(linq, buildLinqReceiveTarget(outcome.target)).send(
                NOTIFY_PROMPT,
                { auth: buildJobAuth(outcome.target) }
              );
            } catch (error) {
              console.error("[google-connect-notify] failed to notify:", error);
            }
          })()
        );
      }

      return Response.redirect(redirectTo.toString(), 302);
    }),
  ],
});
