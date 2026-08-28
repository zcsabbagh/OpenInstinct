import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveLinqJobOwner } from "@/lib/linq-target";
import { isValidTimeZone } from "@/lib/schedule-time";
import { setUserTimezone } from "@/lib/user-prefs";

// The only other writer of workspace_prefs.timezone is create_schedule, and
// only as a side effect of the model happening to pass one while scheduling.
// This tool lets the model save a stated timezone or location immediately,
// so it stops asking once it knows. It always overwrites - a value the user
// just stated in chat outranks anything already on file, including a
// low-confidence guess.
export default defineTool({
  description:
    "Save the user's IANA timezone the moment they state their location or timezone in chat - 'I'm in Chicago', 'I just moved to Austin', 'my timezone is America/New_York'. Convert what they said to the matching IANA zone yourself (e.g. Chicago -> America/Chicago) and pass it here; do not wait for a scheduling request to do this. Once saved, the timezone note at the top of every turn reflects it, so stop asking the user for it.",
  inputSchema: z.object({
    timezone: z
      .string()
      .min(1)
      .describe(
        "IANA timezone, e.g. 'America/Chicago', 'America/New_York', 'Europe/London'."
      ),
  }),
  async execute({ timezone }, ctx) {
    if (!isValidTimeZone(timezone)) {
      throw new Error(`"${timezone}" is not a valid IANA timezone.`);
    }
    const owner = resolveLinqJobOwner(ctx);
    await setUserTimezone(owner.workspaceId, timezone);
    return { saved: true, timezone };
  },
});
