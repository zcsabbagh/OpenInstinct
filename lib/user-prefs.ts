import { eq, isNull } from "drizzle-orm";
import { db, workspacePrefs } from "@/db";

export async function getUserTimezone(
  workspaceId: string
): Promise<string | null> {
  const [row] = await db
    .select({ timezone: workspacePrefs.timezone })
    .from(workspacePrefs)
    .where(eq(workspacePrefs.workspaceId, workspaceId))
    .limit(1);
  return row?.timezone ?? null;
}

export async function setUserTimezone(
  workspaceId: string,
  timezone: string
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db
    .insert(workspacePrefs)
    .values({ workspaceId, timezone, updatedAt })
    .onConflictDoUpdate({
      target: workspacePrefs.workspaceId,
      set: { timezone, updatedAt },
    });
}

export async function hasBeenIntroduced(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ introducedAt: workspacePrefs.introducedAt })
    .from(workspacePrefs)
    .where(eq(workspacePrefs.workspaceId, workspaceId))
    .limit(1);
  return row?.introducedAt != null;
}

/**
 * Durably claims the one-time intro for a workspace. Returns true exactly once
 * per workspace, even across cold starts and concurrent turns, so the staged
 * intro in `agent/channels/linq.ts` is sent a single time.
 */
export async function claimIntroduction(workspaceId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(workspacePrefs)
    .values({ workspaceId, introducedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: workspacePrefs.workspaceId,
      set: { introducedAt: now, updatedAt: now },
      setWhere: isNull(workspacePrefs.introducedAt),
    })
    .returning({ introducedAt: workspacePrefs.introducedAt });
  return row?.introducedAt === now;
}
