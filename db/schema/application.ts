import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId],
      name: "workspace_memberships_pkey",
    }),
    foreignKey({
      name: "workspace_memberships_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("workspace_memberships_role_check", sql`${table.role} = 'owner'`),
  ]
);

export const vaultItems = pgTable(
  "vault_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    account: text("account").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "vault_items_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "vault_items_kind_check",
      sql`${table.kind} IN ('login', 'payment', 'address', 'phone', 'identity', 'token')`
    ),
    index("vault_items_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt.desc().nullsFirst()
    ),
  ]
);

export const settings = pgTable(
  "settings",
  {
    workspaceId: text("workspace_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.key],
      name: "settings_pkey",
    }),
    foreignKey({
      name: "settings_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("settings_key_check", sql`${table.key} = 'gateway_model'`),
  ]
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "agent_sessions_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("agent_sessions_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
  ]
);

export const browserSessions = pgTable(
  "browser_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "browser_sessions_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("browser_sessions_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
  ]
);

export const chats = pgTable(
  "chats",
  {
    sessionId: text("session_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd"),
  },
  (table) => [
    foreignKey({
      name: "chats_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("chats_input_tokens_check", sql`${table.inputTokens} >= 0`),
    check("chats_output_tokens_check", sql`${table.outputTokens} >= 0`),
    check(
      "chats_cost_usd_check",
      sql`${table.costUsd} IS NULL OR ${table.costUsd} >= 0`
    ),
    index("chats_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt.desc().nullsFirst()
    ),
  ]
);

export const encryptedSecrets = pgTable(
  "encrypted_secrets",
  {
    workspaceId: text("workspace_id").notNull(),
    namespace: text("namespace").notNull(),
    id: text("id").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.namespace, table.id],
      name: "encrypted_secrets_pkey",
    }),
    foreignKey({
      name: "encrypted_secrets_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "encrypted_secrets_namespace_check",
      sql`${table.namespace} = 'vault'`
    ),
  ]
);

// Per-workspace preferences. Timezone for scheduled reminders / calendar events,
// and `introducedAt` so the first-contact intro sequence in
// `agent/channels/linq.ts` fires exactly once per user and survives cold starts.
// Not FK'd to workspaces.
export const workspacePrefs = pgTable("workspace_prefs", {
  workspaceId: text("workspace_id").primaryKey(),
  timezone: text("timezone"),
  introducedAt: text("introduced_at"),
  updatedAt: text("updated_at").notNull(),
});

// Invite links. Each existing user can mint up to five; redemption is tracked so
// the Linq front-door gate (`agent/channels/linq.ts`) can let an invited handle
// through. Not FK'd to workspaces: the issuer may be a Linq principal that never
// signed in, and the redeemer has no workspace at redemption time.
export const invites = pgTable(
  "invites",
  {
    code: text("code").primaryKey(),
    issuerWorkspaceId: text("issuer_workspace_id").notNull(),
    issuerPrincipalId: text("issuer_principal_id").notNull(),
    createdAt: text("created_at").notNull(),
    redeemedAt: text("redeemed_at"),
    redeemedByHandle: text("redeemed_by_handle"),
  },
  (table) => [
    index("invites_issuer_idx").on(
      table.issuerWorkspaceId,
      table.createdAt.desc().nullsFirst()
    ),
    index("invites_redeemed_by_idx").on(table.redeemedByHandle),
  ]
);

// Web-monitoring jobs. Each is a saved search that the daily dispatcher
// (agent/schedules/web-monitors.ts) re-runs against the plain Exa Search API
// and diffs against seen URLs. Not FK'd to workspaces: a Linq principal that
// never signed in has no workspace row.
export const webMonitors = pgTable(
  "web_monitors",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ownerPrincipalId: text("owner_principal_id").notNull(),
    authenticator: text("authenticator").notNull(),
    issuer: text("issuer"),
    linqThread: text("linq_thread"),
    ownerHandle: text("owner_handle"),
    query: text("query").notNull(),
    seenItemIds: text("seen_item_ids").notNull(),
    nextCheckAt: text("next_check_at").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    lastCheckedAt: text("last_checked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("web_monitors_due_idx").on(table.nextCheckAt),
    index("web_monitors_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
  ]
);

// User-text-driven reminders and recurring nudges. `everyMinutes` null => one
// time. The dispatcher schedule (agent/schedules/dynamic.ts) claims due rows.
export const schedules = pgTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ownerPrincipalId: text("owner_principal_id").notNull(),
    authenticator: text("authenticator").notNull(),
    issuer: text("issuer"),
    linqThread: text("linq_thread"),
    ownerHandle: text("owner_handle"),
    task: text("task").notNull(),
    nextRunAt: text("next_run_at").notNull(),
    everyMinutes: integer("every_minutes"),
    enabled: integer("enabled").notNull().default(1),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("schedules_due_idx").on(table.enabled, table.nextRunAt),
    index("schedules_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
    check("schedules_enabled_check", sql`${table.enabled} IN (0, 1)`),
    check(
      "schedules_every_minutes_check",
      sql`${table.everyMinutes} IS NULL OR ${table.everyMinutes} >= 1`
    ),
  ]
);

// Non-secret personal identifiers the user routinely says out loud: frequent
// flyer / loyalty numbers, Known Traveler Number, membership IDs, seat and meal
// preferences. Unlike `encrypted_secrets`, these rows ARE returned to the model
// so the agent can recall them several steps into a booking. Values are stored
// in plaintext on purpose: they are low-sensitivity, and it keeps the query
// path simple and auditable. Passwords, card numbers, SSNs, API keys, and OAuth
// tokens must never be written here - those stay in `encrypted_secrets` via the
// web form. Not FK'd to workspaces: a Linq principal that never signed in has
// no workspace row (same rationale as `web_monitors` and `schedules`).
export const vaultNotes = pgTable(
  "vault_notes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    category: text("category"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("vault_notes_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt.desc().nullsFirst()
    ),
  ]
);
