import { eq } from "drizzle-orm";
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
