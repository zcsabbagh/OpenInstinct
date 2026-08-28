import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, webMonitors } from "@/db";
import { env } from "@/lib/env";
import {
  createDailyMonitor,
  createWebset,
  deleteMonitor,
  deleteWebset,
  ensureWebhook,
  itemTitle,
  listWebsetItems,
} from "@/lib/exa";
import type { LinqJobOwner } from "@/lib/linq-target";

// Exa monitors run at most once daily. 13:00 UTC ~= early morning US.
const MONITOR_CRON = "0 13 * * *";
const MONITOR_TIMEZONE = "Etc/UTC";
const SEEN_ITEM_CAP = 500;

export const WEB_MONITOR_WEBHOOK_PATH = "/webhooks/web-monitor";

// Deterministic shared token so the webhook route can authenticate Exa without
// storing per-webhook secrets.
export function webhookToken(): string {
  return createHash("sha256")
    .update(`${env.BETTER_AUTH_SECRET}:web-monitor-webhook`)
    .digest("hex")
    .slice(0, 40);
}

function webhookUrl(): string {
  const url = new URL(WEB_MONITOR_WEBHOOK_PATH, env.BETTER_AUTH_URL);
  url.searchParams.set("token", webhookToken());
  return url.toString();
}

export async function createWebMonitor(
  owner: LinqJobOwner,
  query: string
): Promise<{ id: string; nextRunAt: string | null }> {
  await ensureWebhook(webhookUrl());

  const webset = await createWebset(query);
  let monitor;
  try {
    monitor = await createDailyMonitor({
      websetId: webset.id,
      query,
      cron: MONITOR_CRON,
      timezone: MONITOR_TIMEZONE,
    });
  } catch (error) {
    await deleteWebset(webset.id).catch(() => undefined);
    throw error;
  }

  const id = randomUUID();
  await db.insert(webMonitors).values({
    id,
    workspaceId: owner.workspaceId,
    ownerPrincipalId: owner.ownerPrincipalId,
    authenticator: owner.authenticator,
    issuer: owner.issuer,
    linqThread: owner.linqThread,
    linqThreadId: owner.linqThreadId,
    ownerHandle: owner.ownerHandle,
    query,
    exaWebsetId: webset.id,
    exaMonitorId: monitor.id,
    seenItemIds: "[]",
    createdAt: new Date().toISOString(),
  });

  return { id, nextRunAt: monitor.nextRunAt ?? null };
}

export async function listWebMonitors(
  owner: Pick<LinqJobOwner, "workspaceId">
) {
  const rows = await db
    .select({
      id: webMonitors.id,
      query: webMonitors.query,
      createdAt: webMonitors.createdAt,
    })
    .from(webMonitors)
    .where(eq(webMonitors.workspaceId, owner.workspaceId))
    .orderBy(desc(webMonitors.createdAt));
  return rows;
}

export async function deleteWebMonitor(
  owner: Pick<LinqJobOwner, "workspaceId">,
  id: string
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(webMonitors)
    .where(
      and(
        eq(webMonitors.id, id),
        eq(webMonitors.workspaceId, owner.workspaceId)
      )
    )
    .limit(1);
  if (!row) return false;

  await deleteMonitor(row.exaMonitorId).catch(() => undefined);
  await deleteWebset(row.exaWebsetId).catch(() => undefined);
  await db.delete(webMonitors).where(eq(webMonitors.id, id));
  return true;
}

export interface WebMonitorDelivery {
  monitor: typeof webMonitors.$inferSelect;
  newItems: { title: string; url: string; note: string }[];
}

// Given an Exa event that references a webset or monitor, return the owning row
// and the items we have not delivered yet (then persist that we have seen them).
export async function collectNewItems(ref: {
  websetId?: string;
  monitorId?: string;
}): Promise<WebMonitorDelivery | null> {
  const row = ref.monitorId
    ? await db
        .select()
        .from(webMonitors)
        .where(eq(webMonitors.exaMonitorId, ref.monitorId))
        .limit(1)
        .then((r) => r[0])
    : ref.websetId
      ? await db
          .select()
          .from(webMonitors)
          .where(eq(webMonitors.exaWebsetId, ref.websetId))
          .limit(1)
          .then((r) => r[0])
      : undefined;
  if (!row) return null;

  const items = await listWebsetItems(row.exaWebsetId);
  const seen = new Set<string>(safeParseIds(row.seenItemIds));
  const fresh = items.filter((item) => !seen.has(item.id));
  if (fresh.length === 0) return null;

  const nextSeen = [...seen, ...fresh.map((item) => item.id)].slice(
    -SEEN_ITEM_CAP
  );
  await db
    .update(webMonitors)
    .set({ seenItemIds: JSON.stringify(nextSeen) })
    .where(eq(webMonitors.id, row.id));

  return {
    monitor: row,
    newItems: fresh.slice(0, 10).map((item) => ({
      title: itemTitle(item),
      url: item.properties?.url ?? "",
      note: (item.properties?.description ?? "").trim().slice(0, 300),
    })),
  };
}

function safeParseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
