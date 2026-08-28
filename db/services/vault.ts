import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { vaultItemKindSchema } from "@/lib/manager";
import { db, vaultItems, vaultNotes } from "@/db";

const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

type VaultRecord = z.infer<typeof vaultRecordSchema>;

const selection = {
  account: vaultItems.account,
  createdAt: vaultItems.createdAt,
  id: vaultItems.id,
  kind: vaultItems.kind,
  label: vaultItems.label,
  updatedAt: vaultItems.updatedAt,
};

export async function createVaultItem(scope: AccessScope, record: VaultRecord) {
  await db.insert(vaultItems).values({
    ...record,
    workspaceId: scope.workspaceId,
  });
}

export async function listVaultItems(scope: AccessScope) {
  return vaultRecordSchema
    .array()
    .parse(
      await db
        .select(selection)
        .from(vaultItems)
        .where(eq(vaultItems.workspaceId, scope.workspaceId))
        .orderBy(desc(vaultItems.updatedAt))
    );
}

export async function readVaultItem(scope: AccessScope, id: string) {
  const rows = await db
    .select(selection)
    .from(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .limit(1);
  return vaultRecordSchema.optional().parse(rows[0]);
}

export async function deleteVaultItem(scope: AccessScope, id: string) {
  const rows = await db
    .delete(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .returning({ id: vaultItems.id });
  return rows.length > 0;
}

// `vault_notes` holds non-secret personal identifiers (loyalty numbers, Known
// Traveler Number, membership IDs, travel preferences) that the agent may both
// write from chat and read back. Values are plaintext by design - see the note
// on the table in db/schema/application.ts. Never route a password, card
// number, SSN, API key, or OAuth token through here.

const vaultNoteSchema = z.object({
  category: z.string().nullable(),
  createdAt: z.string(),
  id: z.string(),
  label: z.string(),
  updatedAt: z.string(),
  value: z.string(),
});

type VaultNote = z.infer<typeof vaultNoteSchema>;

const noteSelection = {
  category: vaultNotes.category,
  createdAt: vaultNotes.createdAt,
  id: vaultNotes.id,
  label: vaultNotes.label,
  updatedAt: vaultNotes.updatedAt,
  value: vaultNotes.value,
};

export async function createVaultNote(
  scope: AccessScope,
  input: { label: string; value: string; category?: string | null }
): Promise<VaultNote> {
  const now = new Date().toISOString();
  const category = input.category?.trim();
  const row = {
    category: category && category.length > 0 ? category : null,
    createdAt: now,
    id: randomUUID(),
    label: input.label.trim(),
    updatedAt: now,
    value: input.value.trim(),
    workspaceId: scope.workspaceId,
  };
  await db.insert(vaultNotes).values(row);
  return vaultNoteSchema.parse(row);
}

export async function listVaultNotes(
  scope: AccessScope,
  filter?: { category?: string | null; query?: string | null }
): Promise<VaultNote[]> {
  const conditions = [eq(vaultNotes.workspaceId, scope.workspaceId)];
  const category = filter?.category?.trim();
  if (category) conditions.push(eq(vaultNotes.category, category));
  const query = filter?.query?.trim();
  if (query) conditions.push(ilike(vaultNotes.label, `%${query}%`));
  return vaultNoteSchema.array().parse(
    await db
      .select(noteSelection)
      .from(vaultNotes)
      .where(and(...conditions))
      .orderBy(desc(vaultNotes.updatedAt))
  );
}

export async function deleteVaultNote(scope: AccessScope, id: string) {
  const rows = await db
    .delete(vaultNotes)
    .where(
      and(eq(vaultNotes.workspaceId, scope.workspaceId), eq(vaultNotes.id, id))
    )
    .returning({ id: vaultNotes.id });
  return rows.length > 0;
}
