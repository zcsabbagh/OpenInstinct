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

// Web-monitoring jobs backed by an Exa Webset + Monitor. Not FK'd to workspaces:
// a Linq principal that never signed in has no workspace row.
export const webMonitors = pgTable(
  "web_monitors",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ownerPrincipalId: text("owner_principal_id").notNull(),
    authenticator: text("authenticator").notNull(),
    issuer: text("issuer"),
    linqThread: text("linq_thread"),
    linqThreadId: text("linq_thread_id"),
    ownerHandle: text("owner_handle"),
    query: text("query").notNull(),
    exaWebsetId: text("exa_webset_id").notNull(),
    exaMonitorId: text("exa_monitor_id").notNull(),
    seenItemIds: text("seen_item_ids").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("web_monitors_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
    index("web_monitors_exa_webset_idx").on(table.exaWebsetId),
    index("web_monitors_exa_monitor_idx").on(table.exaMonitorId),
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
