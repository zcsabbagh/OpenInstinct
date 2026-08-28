# Persistent browser sessions (Kernel profiles)

## Problem

The vault path (`request_vault_setup` → web form → `fill_from_vault`) only
handles **password logins**. It cannot do:

- "Continue with Google / Apple / Microsoft" SSO
- passkey logins
- any site where the real credential is a live session cookie, not a password

And every task browser starts cold, so even after a manual login the session is
gone on the next request. A Google sign-in with 2FA has to be redone every time.

## Approach

Kernel has a first-class **Profiles** API. A profile is a server-side snapshot
of a browser's cookies + localStorage + IndexedDB, stored at Kernel and keyed by
name.

- `client.profiles.create({ name })`
- `client.browsers.create({ profile: { name, save_changes } })` — loads the
  profile's state into the session; if `save_changes: true`, writes it back when
  the session ends
- `client.profiles.retrieve / list / delete / download`

One profile per workspace. The user signs into Google (or anything) **once**, in
a live headful browser, does the 2FA there, and Kernel folds the resulting
session into the profile. Every task browser after that launches with the
profile loaded, so SSO logins just work.

### IP stability matters

Google (and banks) re-challenge when a session's IP jumps around. Kernel's
default stealth proxy **rotates IPs per session**, which would trigger "verify
it's you" constantly and defeat the purpose. So each workspace also gets a
**pinned dedicated proxy** (`client.proxies.create({ type: "isp" | "residential" })`),
passed as `proxy: { id }` on every launch that uses the profile. With a stable
IP a Google session survives weeks; without one it may not survive a day.

## Components

### 1. `kernel_profiles` table (migration 0007)

```
kernel_profiles
  workspace_id   text primary key      -- not FK'd to workspaces (same as web_monitors)
  profile_name   text not null unique  -- e.g. "ws-<first 16 of workspaceId hash>"
  proxy_id       text                  -- Kernel proxy id, nullable until provisioned
  created_at     text not null
  updated_at     text not null
```

`lib/kernel-profile.ts`:

- `getOrCreateWorkspaceProfile(scope): { profileName, proxyId }` — lazily calls
  `profiles.create` + `proxies.create` on first use, upserts the row, returns
  the handles. Idempotent under concurrency (unique constraint + catch).
- `deleteWorkspaceProfile(scope)` — `profiles.delete` + `proxies.delete` + drop
  the row. Called from workspace teardown if/when that exists.

### 2. Every browser launch loads the profile

`agent/extensions/kernel/browser-runtime.ts` → `manageOwnedKernelBrowsers`
`create` branch:

```ts
const { profileName, proxyId } = await getOrCreateWorkspaceProfile(scope);
const browser = await client.browsers.create({
  profile: { name: profileName, save_changes: false }, // read-only for tasks
  proxy: proxyId ? { id: proxyId } : undefined,
  stealth: true,
  timeout_seconds: input.timeout_seconds ?? 900,
  viewport: browserViewport(input),
});
```

`save_changes: false` on ordinary task browsers so a routine automation can't
corrupt the saved login state. Only the connect flow (below) writes back.

### 3. `connect_site_login` tool (new)

`agent/tools/connect_site_login.ts`

- Input: `{ service: string }` — a label like "Google", "Notion", "United".
- Resolves a login URL: a small known-service map
  (`google → https://accounts.google.com`, …), else navigate to the service's
  domain and let the user drive.
- Launches a **headful** browser with `profile: { name, save_changes: true }`
  and the pinned proxy.
- Returns `{ liveViewUrl, browserSessionId }`. The channel sends the user the
  live-view URL: "open this, sign in (2FA and all), then tell me you're done."
- Leaves the browser **open** — this is exactly the existing "keep the browser
  open for a required human action" pattern in `agent/instructions.md`.

### 4. `finish_site_login` tool (new) — or reuse `manage_browsers` delete

- Input: `{ browserSessionId }`.
- Verifies the session is owned by the workspace, then `browsers.deleteByID` —
  **ending the session is what makes Kernel persist state back to the profile**.
- Updates `kernel_profiles.updated_at`, deletes the `browser_sessions` row,
  confirms to the user.

### 5. Instructions (`agent/instructions.md`)

New section, roughly:

> # Connecting a login (SSO / 2FA sites)
>
> - When a sign-in page only offers "Continue with Google/Apple" or a passkey,
>   or the user asks to connect an account like Google, use
>   `connect_site_login`. Send them the live-view link on its own line and tell
>   them to sign in there, 2FA included, then say when they're done. Call
>   `finish_site_login` when they confirm.
> - This is a one-time step per service. After it, their session is loaded into
>   every browser you open, so "Continue with Google" on other sites just works.
> - Never screenshot, read, or inspect the live-view browser while the user is
>   signing in. Same rule as vault fill: you do not look at the credential.
> - If a task browser hits a login wall on a site that should already be
>   connected, the saved session probably expired. Tell the user and offer to
>   run `connect_site_login` again.

### 6. Env

`lib/env.ts`: no new required vars. Optionally
`KERNEL_PROFILE_PROXY_TYPE` (default `"isp"`) to control proxy quality/cost.

## Security notes

- The profile holds the user's live authenticated sessions. It is at least as
  sensitive as the vault. It lives only at Kernel, scoped to `KERNEL_API_KEY`.
  No profile contents ever enter our database or the model's context.
- `profiles.download` must never be exposed as a tool.
- The live-view URL for a connect session is effectively a credential-entry
  surface — treat it like the vault link: send once, do not log it, do not
  screenshot the session.
- One profile per workspace covers all origins. If a "keep banking separate"
  need shows up later, add a `profile_scope` column and a second profile;
  not now.

## Out of scope (later iterations)

- **In-band OTP relay**: agent pauses mid-task, texts the user "enter the code
  Google just sent", user replies, agent types it into the live session. v1
  just re-runs `connect_site_login` interactively when a session expires.
- Proactive session refresh before expiry.
- Sharing one Google connection across "Continue with Google" _and_ the Gmail
  API connection (they stay separate: API tokens vs browser cookies).

## Decisions needed

1. **Proxy**: provision a dedicated ISP/residential proxy per workspace
   (recommended — it's the difference between a Google session lasting weeks vs.
   hours), or ship without and accept frequent re-auth?
2. **Connect-session timeout**: how long to give the user to finish an
   interactive login before Kernel kills the headful browser? (recommend 30 min)
3. **Scope**: one profile per workspace (recommended) vs. per-service profiles?
