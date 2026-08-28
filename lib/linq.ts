import { connectLinqCredentials } from "@vercel/connect/eve";
import type {
  LinqChannelCredentials,
  LinqCredentialValue,
} from "eve/channels/linq";
import { env } from "@/lib/env";

export const LINQ_CONNECTOR = "linq/eve-kernel";

// Single source of truth for how this app resolves Linq credentials: a
// static key when both env vars are set (self-hosted / portable
// credentials), otherwise a short-lived Vercel Connect token. Shared by
// agent/channels/linq.ts (channel setup) and lib/linq-reactions.ts (a direct
// outbound call to Linq's REST API, since eve's linqChannel does not expose
// a public API for sending a reaction) so both ever resolve the same key.
export function linqCredentials(): LinqChannelCredentials {
  return env.LINQ_API_KEY && env.LINQ_WEBHOOK_SECRET
    ? {
        apiKey: env.LINQ_API_KEY,
        signingSecret: env.LINQ_WEBHOOK_SECRET,
      }
    : connectLinqCredentials(LINQ_CONNECTOR);
}

async function resolveCredentialValue(
  value: LinqCredentialValue | undefined
): Promise<string | undefined> {
  return typeof value === "function" ? value() : value;
}

/**
 * Resolves a usable Linq API key for a one-off outbound call made outside
 * `linqChannel()`'s own request handling (see lib/linq-reactions.ts).
 */
export async function resolveLinqApiKey(): Promise<string> {
  const apiKey = await resolveCredentialValue(linqCredentials().apiKey);
  if (!apiKey) throw new Error("No Linq API key is configured.");
  return apiKey;
}
