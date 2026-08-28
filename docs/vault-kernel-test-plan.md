# Vault → Kernel end-to-end test plan

How to verify the "Mouse sends a link, user fills credentials, they're
encrypted, and Kernel injects them into a live browser" flow.

## How the flow is wired

1. **Link** — the `request_vault_setup` tool returns
   `${BETTER_AUTH_URL}/vault?setup=vault&kind=login&label=<Site>&account=<hint>`.
2. **Sign-in** — `/vault` requires a Better Auth session with a _verified phone
   number_. Sign-in is phone-OTP and the code is delivered over the **same Linq
   iMessage line** (`auth.ts` → `sendPhoneCode`).
3. **Store** — the form POSTs `vault.create` to `/api/manager` →
   `applyManagerMutation` → `writeSecret` encrypts with AES-256-GCM
   (`SECRET_ENCRYPTION_KEY`, per-secret IV, AAD =
   `workspaceId \0 vault \0 id`) into `encrypted_secrets`; metadata into
   `vault_items`.
4. **Read** — the agent's `list_vault` returns opaque handles (the
   `vault_items.id`), never values.
5. **Inject** — the agent opens a Kernel browser (`manage_browsers`), inspects
   the login form, then calls `fill_from_vault` with the handle + exact origin +
   CSS selectors. The value is decrypted server-side, typed into the page by a
   generated Playwright script, and never returned to the model.

## The load-bearing assumption: identity linkage

The web page and the agent only share a vault when they resolve to the **same
`workspaceId`**. Both compute
`workspaceId = "personal:" + sha256("better-auth:" + userId).slice(0, 32)`:

- **Web** (`app/_lib/server/request-scope.ts`): `userId` = the Better Auth
  session user id.
- **Linq** (`agent/channels/linq.ts`): `userId` is recovered by normalizing the
  sender's handle to E.164 and matching a Better Auth user with that
  **verified** phone number (`findVerifiedAuthUserIdByPhoneNumber`). No match →
  the agent falls back to the raw Linq principal → a _different, empty_
  workspace, and nothing downstream works.

So the first real check is: **text from the same number you verified on the
web.**

## Stage 0 — Preconditions (backend, no phone)

- Latest production deploy is `READY` (Vercel project `mouse`).
- `KERNEL_API_KEY` and `SECRET_ENCRYPTION_KEY` are set in the project (both are
  required by `lib/env.ts`, so a green build already implies this).
- In Neon: `select id, "phoneNumber", "phoneNumberVerified" from "user";` — you
  need a row with your phone and `phoneNumberVerified = true`. If the table is
  empty you have never signed in on the web; do Stage 2 first.

## Stage 1 — Kernel smoke (backend script)

```sh
node --experimental-strip-types --env-file=.env.local scripts/kernel-smoke.ts
# or: pnpm kernel:smoke   (with KERNEL_API_KEY in the environment)
```

Expect: a session id, a live-view URL, then
`{"title":"Example Domain","url":"https://example.com/"}` and `PASS`. This
exercises the exact SDK path `agent/extensions/kernel/browser-runtime.ts` uses.

## Stage 2 — Link → encrypt → store (web, phone)

1. Text Mouse: **"let's log into Amazon"**. Expect a
   `/vault?setup=vault&kind=login&label=Amazon` link.
2. Open it, sign in (phone number → OTP arrives in iMessage), fill dummy
   credentials, Save.
3. Backend check:

   ```sql
   select workspace_id, kind, label, account, created_at from vault_items order by created_at desc limit 5;
   select workspace_id, id, left(encrypted_value, 3) as prefix, updated_at from encrypted_secrets order by updated_at desc limit 5;
   ```

   Expect one `vault_items` row (`kind = login`, `label = Amazon`), one
   `encrypted_secrets` row with the same `workspace_id` and `prefix = v1.`.

## Stage 3 — Agent sees the handle (the critical check)

Text Mouse: **"what logins do you have saved?"** → it should list "Amazon".

If it does not: the identity linkage is broken. Look for
`[vault] list_vault empty: workspace=personal:...` in the runtime logs and
compare that `workspaceId` to `personal:sha256("better-auth:" + <your user
id>)`. Usual cause: the number you texted from does not normalize to your
verified `phoneNumber`.

## Stage 4 — End-to-end injection on a benign site

1. In the vault, save a throwaway login with label `the-internet` and account
   `tomsmith`, secret `SuperSecretPassword!`
   (target: `https://the-internet.herokuapp.com/login`).
2. Text Mouse: **"log into the-internet.herokuapp.com with my saved login"**.
3. Watch it: create a Kernel browser, inspect the form, call `fill_from_vault`,
   submit, report "You logged into the secure area!".
4. Backend check:

   ```sql
   select workspace_id, session_id, created_at from browser_sessions order by created_at desc limit 5;
   ```

   Expect a new row; the Kernel dashboard shows the session; the run transcript
   shows `fill_from_vault` returning `filledFields: ["username", "password"]`.

## Stage 5 — Amazon for real

Repeat Stage 4 with real Amazon credentials. Amazon splits email and password
across two pages and frequently challenges with OTP or CAPTCHA. A 2FA / CAPTCHA
wall is the **known limitation**, not a regression — that is the human-in-the-
loop work that is still to come.

## Known gaps (not blockers for this test)

- Second factor / emailed or texted codes are not handled yet.
- Re-auth mid-session (session expiry inside a long task) is untested.
- The agent must discover selectors itself; a heavily obfuscated or
  bot-protected login can defeat it regardless of the vault.
