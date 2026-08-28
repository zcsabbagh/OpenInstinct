# TODOs

Open items from the Linq / background-jobs work. Grouped by area, roughly in
priority order.

## Web monitor

- [ ] **Verify end to end live.** Text "monitor the web for X", confirm a
      `web_monitors` row is created and seeded (`seen_item_ids` populated), then
      confirm the `*/15` dispatcher (`agent/schedules/web-monitors.ts`) runs a due
      search and delivers a hit to the iMessage thread. Nothing has run since the
      Websets -> plain-search rework (#12).
- [ ] **Confirm the Vercel Cron job registered** for `agent/schedules/web-monitors.ts`.
      Vercel -> Settings -> Cron Jobs should show a second `* * * * *`/`*/15` entry
      alongside the reminder dispatcher.
- [ ] **Recency, not just relevance.** Plain Exa search returns the top results
      by relevance, so a daily "J Cole Bay Area shows" query can return the same
      evergreen pages forever and never surface a genuinely new announcement. Add a
      `startPublishedDate` (last ~7 days) filter, or a second pass sorted by date,
      or bias the query. Right now dedup-by-URL is the only thing making it a
      "monitor".
- [ ] **Re-announcements on the same URL never re-alert** (dedup is exact URL).
      Acceptable for now; note it.
- [ ] **Per-workspace monitor cap** - nothing stops the agent creating dozens.
      Add a limit in `create_web_monitor` (e.g. 10 active per workspace).
- [ ] Consider a dedicated events source (Bandsintown / Ticketmaster) for the
      concert case - structured, free, catches exact date/venue/ticket URL.

## Reminders / schedules

- [ ] **Test the recurring path live** ("text me every day at 9am"). One-time
      and the delivery pipeline are confirmed; recurring is not.
- [ ] **Recurring reminders drift later each day.** `completeRun` sets the next
      run to `max(now, nextRunAt) + everyMinutes`, so a fire that lands 40s late
      pushes every subsequent fire 40s later. Anchor daily reminders to the
      original wall-clock time instead.
- [ ] **`sleep` tool horizon** - it's enabled for "remind me in a couple
      minutes" in-conversation, but confirm eve's max sleep duration and that the
      instructions steer anything longer to `create_schedule`.

## Voice notes / images

- [ ] **Confirm Linq delivers a usable audio URL + MIME.** `agent/channels/linq.ts`
      reads `message.attachments`; the reference `mouse` repo parsed the raw webhook
      `parts[]`. If Linq doesn't populate `attachments.url` for an iMessage voice
      memo, every voice note hits the "mind typing it?" fallback.
- [ ] **Confirm the Chat SDK `Message` is mutable** at the `onMessage` seam - the
      transcript is folded in by editing the message in place. If it's frozen,
      same fallback.
- [ ] **Confirm photos come through as `image/*`**, not `application/octet-stream`
      (the latter makes `@ai-sdk/anthropic` drop the image).

## Google Workspace

- [ ] **`search_contacts` is broken** - `google_workspace_read` exposes it but
      the OAuth scope set has no People/Contacts scope. Either add
      `.../auth/contacts.readonly` (sensitive, no CASA) or remove the action.
- [ ] **Restricted Gmail scope.** Scopes include `https://mail.google.com/`
      (restricted) - blocks publishing the OAuth app without a CASA assessment and
      causes 7-day token expiry in Testing mode. Drop to
      `.../auth/gmail.modify` (sensitive) unless full IMAP/delete is actually needed.

## Infra / cleanup

- [ ] **`MemoryStateAdapter is not recommended for production`** - the chat-sdk
      state adapter is in-memory. Move to `@chat-adapter/state-redis` (or Upstash)
      so thread subscriptions and inbound dedup survive restarts.
- [ ] Some `/.well-known/workflow/v1/flow` calls route to an older deployment id
      in the logs (eve workflow-world pinning). Understand whether that's expected.
- [ ] `lib/linq-target.ts` still carries an unused `linqThreadId` field on
      `LinqJobOwner` (nothing populates it). Remove or wire it as the `{adapterName,
threadId}` fallback for proactive delivery.
