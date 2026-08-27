import { defineChannel, POST } from "eve/channels";
import { z } from "zod";
import linq from "@/agent/channels/linq";
import { buildJobAuth, buildLinqReceiveTarget } from "@/lib/linq-target";
import {
  collectNewItems,
  WEB_MONITOR_WEBHOOK_PATH,
  webhookToken,
} from "@/lib/web-monitor";

// Exa webhook events carry "the full resource that triggered the event" in
// `data`; we only need whichever id points back at one of our monitor rows.
const exaEventSchema = z.object({
  type: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
      websetId: z.string().optional(),
      monitorId: z.string().optional(),
      webset: z.object({ id: z.string().optional() }).optional(),
      monitor: z.object({ id: z.string().optional() }).optional(),
    })
    .optional(),
});

// Receives Exa Webset/Monitor webhook events and, for each web-monitor job with
// new results, starts a Linq session that tells the user what turned up.
export default defineChannel({
  routes: [
    POST(WEB_MONITOR_WEBHOOK_PATH, async (request, { to, waitUntil }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("token") !== webhookToken()) {
        return new Response("forbidden", { status: 403 });
      }

      const parsed = exaEventSchema.safeParse(
        await request.json().catch(() => null)
      );
      if (!parsed.success) return new Response("bad request", { status: 400 });

      const { type, data } = parsed.data;
      const websetId = data?.websetId ?? data?.webset?.id;
      const monitorId =
        data?.monitorId ??
        data?.monitor?.id ??
        (type?.startsWith("monitor") ? data?.id : undefined);

      if (!websetId && !monitorId) return new Response(null, { status: 202 });

      waitUntil(
        (async () => {
          const delivery = await collectNewItems({ websetId, monitorId });
          if (!delivery) return;

          const target = buildLinqReceiveTarget(delivery.monitor);
          const auth = buildJobAuth(delivery.monitor);
          const lines = delivery.newItems.flatMap((item) => {
            const head = item.note
              ? `${item.title} - ${item.note}`
              : item.title;
            return item.url ? [head, item.url] : [head];
          });

          await to(linq, target).send(
            [
              `Your web monitor "${delivery.monitor.query}" found ${String(delivery.newItems.length)} new result(s). Tell the user, plainly. Put each URL on its own line.`,
              "",
              ...lines,
            ].join("\n"),
            { auth }
          );
        })()
      );

      return new Response(null, { status: 202 });
    }),
  ],
});
