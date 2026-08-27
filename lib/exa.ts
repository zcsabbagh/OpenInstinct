import { z } from "zod";
import { env } from "@/lib/env";

// Minimal client for the Exa Websets API (websets, monitors, webhooks, items).
// Docs: https://exa.ai/docs/websets/api-guide

const WEBSETS_BASE = "https://api.exa.ai/websets/v0";
const WEBHOOKS_BASE = "https://api.exa.ai/v0";

function requireKey(): string {
  const key = env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set.");
  return key;
}

async function exaFetch<TSchema extends z.ZodType>(
  url: string,
  schema: TSchema,
  init: RequestInit = {}
): Promise<z.infer<TSchema>> {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", requireKey());
  headers.set("content-type", "application/json");

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Exa ${init.method ?? "GET"} ${url} -> ${String(response.status)}: ${JSON.stringify(body).slice(0, 400)}`
    );
  }
  return schema.parse(body);
}

const websetSchema = z.object({ id: z.string() });
const monitorSchema = z.object({
  id: z.string(),
  nextRunAt: z.string().nullish(),
});
const websetItemSchema = z.object({
  id: z.string(),
  properties: z
    .object({
      url: z.string().optional(),
      description: z.string().optional(),
      article: z.object({ title: z.string().optional() }).optional(),
      researchPaper: z.object({ title: z.string().optional() }).optional(),
      company: z.object({ name: z.string().optional() }).optional(),
      person: z.object({ name: z.string().optional() }).optional(),
      custom: z.object({ title: z.string().optional() }).optional(),
    })
    .optional(),
});
const itemsPageSchema = z.object({
  data: z.array(websetItemSchema).optional(),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().nullish(),
});
const webhookListSchema = z.object({
  data: z.array(z.object({ url: z.string() })).optional(),
});

export type ExaWebsetItem = z.infer<typeof websetItemSchema>;

// Websets require a search; use the same query the monitor will run.
export function createWebset(query: string) {
  return exaFetch(`${WEBSETS_BASE}/websets`, websetSchema, {
    method: "POST",
    body: JSON.stringify({ search: { query, count: 10 } }),
  });
}

export function deleteWebset(id: string) {
  return exaFetch(
    `${WEBSETS_BASE}/websets/${encodeURIComponent(id)}`,
    z.unknown(),
    {
      method: "DELETE",
    }
  );
}

// cron must be at most once daily. timezone is IANA.
export function createDailyMonitor(input: {
  websetId: string;
  query: string;
  cron: string;
  timezone: string;
}) {
  return exaFetch(`${WEBSETS_BASE}/monitors`, monitorSchema, {
    method: "POST",
    body: JSON.stringify({
      websetId: input.websetId,
      cadence: { cron: input.cron, timezone: input.timezone },
      behavior: {
        type: "search",
        config: { query: input.query, count: 10, behavior: "append" },
      },
    }),
  });
}

export function deleteMonitor(id: string) {
  return exaFetch(
    `${WEBSETS_BASE}/monitors/${encodeURIComponent(id)}`,
    z.unknown(),
    {
      method: "DELETE",
    }
  );
}

export async function listWebsetItems(
  websetId: string
): Promise<ExaWebsetItem[]> {
  const items: ExaWebsetItem[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const page = await exaFetch(
      `${WEBSETS_BASE}/websets/${encodeURIComponent(websetId)}/items?${params.toString()}`,
      itemsPageSchema
    );
    items.push(...(page.data ?? []));
    cursor = page.hasMore ? (page.nextCursor ?? undefined) : undefined;
  } while (cursor && items.length < 500);
  return items;
}

export function itemTitle(item: ExaWebsetItem): string {
  const p = item.properties;
  return (
    p?.article?.title ??
    p?.researchPaper?.title ??
    p?.company?.name ??
    p?.person?.name ??
    p?.custom?.title ??
    p?.url ??
    "result"
  );
}

// One deployment-wide webhook. Registered lazily; identified by its URL so we
// never create a duplicate.
export async function ensureWebhook(url: string): Promise<void> {
  const existing = await exaFetch(
    `${WEBHOOKS_BASE}/webhooks`,
    webhookListSchema
  );
  if ((existing.data ?? []).some((webhook) => webhook.url === url)) return;
  await exaFetch(`${WEBHOOKS_BASE}/webhooks`, z.unknown(), {
    method: "POST",
    body: JSON.stringify({
      url,
      events: ["monitor.run.completed", "webset.search.completed"],
    }),
  });
}
