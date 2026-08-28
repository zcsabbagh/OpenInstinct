import { defineSchedule } from "eve/schedules";
import { claimDue, completeRun, releaseRun } from "@/agent/lib/schedule-store";
import linq from "@/agent/channels/linq";
import { buildJobAuth, buildLinqReceiveTarget } from "@/lib/linq-target";

// One authored schedule. Every minute it leases due reminder rows and hands each
// to the Linq conversation as a fresh session, with a prompt that yields a
// naturally worded reminder - varied each fire, never a canned template.
export default defineSchedule({
  cron: "* * * * *",
  run({ to, waitUntil }) {
    waitUntil(
      (async () => {
        const rows = await claimDue({
          now: new Date(),
          leaseForMs: 5 * 60_000,
        });

        await Promise.all(
          rows.map(async (row) => {
            try {
              await to(linq, buildLinqReceiveTarget(row)).send(
                [
                  `The user asked to be reminded to: ${row.task}`,
                  'Send them that reminder now, in one or two short lines. Word it freshly and naturally - do not use a fixed template or the phrase "here is your reminder" every time.',
                ].join("\n\n"),
                { auth: buildJobAuth(row) }
              );
              await completeRun(row);
            } catch {
              await releaseRun(row, new Date(Date.now() + 5 * 60_000));
            }
          })
        );
      })()
    );
  },
});
