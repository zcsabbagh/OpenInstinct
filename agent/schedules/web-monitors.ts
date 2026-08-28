import { defineSchedule } from "eve/schedules";
import { resultTitle } from "@/lib/exa";
import { buildJobAuth, buildLinqReceiveTarget } from "@/lib/linq-target";
import {
  claimDueMonitors,
  completeMonitorCheck,
  monitorSearch,
  releaseMonitorCheck,
  selectFreshResults,
} from "@/lib/web-monitor";
import linq from "@/agent/channels/linq";

// Fires every 15 minutes but only touches monitors whose next_check_at has
// passed, so each monitor effectively runs one Exa search a day. New results
// go back to the originating iMessage conversation as a fresh session.
export default defineSchedule({
  cron: "*/15 * * * *",
  run({ to, waitUntil }) {
    waitUntil(
      (async () => {
        const rows = await claimDueMonitors({
          now: new Date(),
          leaseForMs: 10 * 60_000,
        });

        await Promise.all(
          rows.map(async (row) => {
            try {
              const results = await monitorSearch(row.query);
              const fresh = selectFreshResults(row.seenItemIds, results);

              if (fresh.length > 0) {
                const lines = fresh.flatMap((result) => [
                  resultTitle(result),
                  result.url,
                ]);
                await to(linq, buildLinqReceiveTarget(row)).send(
                  [
                    `The user's web monitor for "${row.query}" turned up ${String(fresh.length)} new result(s). Tell them what it found, plainly. Put each link on its own line.`,
                    "",
                    ...lines,
                  ].join("\n"),
                  { auth: buildJobAuth(row) }
                );
              }

              await completeMonitorCheck(row, results);
            } catch {
              await releaseMonitorCheck(
                row,
                new Date(Date.now() + 60 * 60_000)
              );
            }
          })
        );
      })()
    );
  },
});
