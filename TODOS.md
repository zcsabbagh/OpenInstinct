# TODOs

Open items from the Linq / background-jobs work. Grouped by area, roughly in
priority order.

## Built but unverified (live)

These are code-complete and unit-tested, but nothing has actually exercised
them end to end against a live deployment. Different risk than "not built."

- [ ] **Web monitor end to end.** Text "monitor the web for X", confirm a
      `web_monitors` row is created and seeded (`seen_item_ids` populated),
      then confirm the `*/15` dispatcher (`agent/schedules/web-monitors.ts`)
      runs a due search and delivers a hit to the iMessage thread. The Vercel
      Cron entry is registered (`vercel crons ls` shows both the `* * * * *`
      and `*/15 * * * *` jobs) and creation-time seeding is unit-tested
      (`tests/web-monitor.test.ts`), but nothing has actually fired for real
      since the Websets -> plain-search rework, the recency filter, or the
      per-workspace cap.
- [ ] **A recurring reminder actually firing.** The drift fix and
      weekly/monthly/yearly recurrence (`lib/schedule-time.ts`,
      `nextRecurrence`) are implemented with thorough tests, including a
      drift regression and DST/month-end/leap-day clamping - but no reminder
      has actually recurred against a deployed schedule.
- [ ] **Voice notes.** Transcription is implemented
      (`agent/channels/linq.ts`'s `foldVoiceNoteIntoMessage` +
      `agent/lib/voice.ts`), with a defensive fallback if the runtime
      `Message` object refuses the in-place attachment/text edit - but it has
      never been fed a real Linq voice-memo webhook.
- [ ] **Inbound photos.** No extra code was needed - eve's `messageToUserContent`
      is assumed to already turn an image attachment into an `image/*` file
      part, which `@ai-sdk/anthropic` converts to a native image block. That
      assumption has never been checked against a real inbound photo; if Linq
      actually delivers `application/octet-stream` instead, the image gets
      silently dropped.

## Web monitor

- [ ] **Re-announcements on the same URL only partially re-alert.** Dedup now
      keys on `{url, publishedDate}` (`lib/web-monitor.ts`), so a republish
      that advances the published date re-alerts. A same-date content edit at
      the same URL still won't. Acceptable for now; note it.
- [ ] Consider a dedicated events source (Bandsintown / Ticketmaster) for the
      concert case - structured, free, catches exact date/venue/ticket URL.

## Reminders / schedules

- [ ] **`sleep` tool horizon is a soft cap, not a hard one.** `agent/instructions.md`
      caps in-conversation `sleep` at 10 minutes and steers longer waits to
      `create_schedule`, but eve's actual `sleep` tool has no meaningful
      SDK-level ceiling (`MAX_SLEEP_SECONDS` is effectively unbounded). The
      limit only holds if the model follows the instruction.

## Human-in-the-loop resume over iMessage

- [ ] **Resume is unbuilt.** `agent/channels/linq.ts` now renders an
      `input.requested` event as plain iMessage text (`lib/hitl-prompt.ts`,
      branch `linq-hitl`, unmerged), so a pending question at least shows up.
      But nothing turns an inbound reply back into a resumed turn - there is
      currently no way to answer an agent's question mid-task over iMessage.
      `docs/hitl-inputresponses-reference.md` (also on `linq-hitl`)
      documents the resume contract the deleted web chat used to implement,
      as the starting point.

## Kernel / browser sessions

- [ ] **Persistent browser sessions are designed, not built.**
      `docs/kernel-persistent-sessions-design.md` lays out a
      `kernel_profiles` table + `lib/kernel-profile.ts` so a Google (or any)
      sign-in survives across task browsers, pinned to a per-workspace proxy
      for IP stability. `scripts/kernel-profile.ts` is a manual CLI spike
      that proves the underlying Kernel profile/proxy mechanics work, but
      none of it is wired into `agent/extensions/kernel` yet.

## Google Workspace

- [ ] **Gmail unsubscribe and block.** Not built. Needs the
      `gmail.settings.basic` scope (a new sensitive scope, same
      disconnect/reconnect gotcha as the last scope change).
- [ ] **Proactive Gmail/Calendar monitoring.** Not built -
      `agent/schedules/` only has `dynamic.ts` (reminders) and
      `web-monitors.ts`; nothing watches the mailbox or calendar for changes.

## Vault

- [ ] **Add a `totp` kind.** `vault_items_kind_check` currently only allows
      `login`, `payment`, `address`, `phone`, `identity`, `token`.

## Infra / cleanup

- [ ] `lib/durable-state.ts` gives the Linq channel durable, Postgres-backed
      _dedup_ (a redelivered webhook is handled once) because eve's
      `linqChannel` hardcodes `createMemoryState()` with no config option to
      swap it - checked against both the installed and latest eve versions.
      That's the narrow problem application code can reach; the broader Chat
      SDK state (thread subscriptions) is still in-memory and still won't
      survive a restart. Not actionable from this repo without an upstream
      eve change - noting it as a known limitation rather than an open task.
- [ ] Some `/.well-known/workflow/v1/flow` calls route to an older deployment
      id in the logs (eve workflow-world pinning). Understand whether that's
      expected. Still unresolved; no further data since it was first noted.
- [ ] Six test files each define their own near-identical local database
      setup helper (spin up a `PGlite` client, replay a hardcoded migration
      list, wrap it in `drizzle()` with a stubbed `batch()`, cast to
      `Database`): `tests/invites.test.ts`, `tests/web-monitor.test.ts`,
      `tests/services.test.ts`, `tests/timezone.test.ts`,
      `tests/vault-link.test.ts`, `tests/vault-notes.test.ts`. Worth
      extracting into one shared helper. (`tests/database-migration.test.ts`
      also uses PGlite but genuinely needs per-migration granularity, so it's
      not part of this duplication.)
