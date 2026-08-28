/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-argument, typescript/no-unsafe-type-assertion -- Eve's Linq adapter exposes the thread and message through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import {
  defaultLinqAuth,
  type LinqInboundMessageContext,
  linqChannel,
} from "eve/channels/linq";
import { z } from "zod";
import { auth } from "@/auth";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { claimOnce } from "@/lib/durable-state";
import { inviteGateEnabled } from "@/lib/env";
import { syncGoogleCalendarTimezoneIfDue } from "@/lib/google-workspace/calendar-timezone";
import {
  getGoogleWorkspaceConnection,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";
import {
  anyInvitesExist,
  isHandleInvited,
  workspaceHasActivity,
} from "@/lib/invites";
import { renderInputRequest } from "@/lib/hitl-prompt";
import { linqCredentials } from "@/lib/linq";
import { splitMessageIntoBubbles } from "@/lib/message-bubbles";
import { buildGoogleConnectNotifyUrl } from "@/lib/google-connect-notify";
import { saveDurableLinqTarget } from "@/lib/linq-target";
import { normalizeAuthPhoneNumber } from "@/lib/auth/phone-number";
import {
  claimIntroduction,
  getUserTimezonePref,
  hasBeenIntroduced,
} from "@/lib/user-prefs";
import { nextRound, sendPacedOnboarding } from "@/lib/paced-onboarding";
import { transcribeAudio } from "@/agent/lib/voice";

interface InboundAttachment {
  name?: string;
  mimeType?: string;
  url?: string;
}

function isAudioAttachment(attachment: InboundAttachment): boolean {
  const mime = attachment.mimeType ?? "";
  if (mime.startsWith("audio/")) return true;
  return /\.(m4a|mp3|aac|caf|wav|aiff|amr|ogg|opus)$/iu.test(
    attachment.name ?? ""
  );
}

/**
 * Voice notes: transcribe with ElevenLabs and fold the text into the message,
 * dropping the audio attachment. Claude can't take audio and the AI SDK
 * Anthropic provider throws on an audio file part, so the transcript has to
 * replace it before the turn starts.
 *
 * Returns false when the message could not be made model-safe (transcription
 * failed, or the runtime Message object refused the edit); the caller then
 * acknowledges to the user and drops the turn instead of letting it crash.
 */
async function foldVoiceNoteIntoMessage(message: {
  attachments?: readonly InboundAttachment[];
  text?: string;
}): Promise<boolean> {
  const attachments = (message.attachments ?? []) as InboundAttachment[];
  const audio = attachments.filter(
    (attachment): attachment is InboundAttachment & { url: string } =>
      isAudioAttachment(attachment) &&
      typeof attachment.url === "string" &&
      attachment.url.length > 0
  );
  if (audio.length === 0) return true;

  let transcript: string;
  try {
    const parts = await Promise.all(
      audio.map((attachment) => transcribeAudio(attachment.url))
    );
    transcript = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  } catch (error) {
    console.warn("[linq] voice transcription failed:", error);
    return false;
  }
  if (!transcript) return false;

  const mutable = message as { attachments?: unknown; text?: string };
  try {
    mutable.attachments = attachments.filter(
      (attachment) => !isAudioAttachment(attachment)
    );
    mutable.text = [message.text, transcript]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return false;
  }

  const stillHasAudio = (
    (message.attachments ?? []) as InboundAttachment[]
  ).some(isAudioAttachment);
  return !stillHasAudio && Boolean(message.text);
}

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});

// Suppress repeat Google onboarding prompts within one warm instance. eve keeps
// one session per Linq conversation, so a warm lambda handling that conversation
// won't re-prompt; a cold start may prompt once more, which is acceptable.
const ONBOARDING_PROMPT_TTL_MS = 60 * 60 * 1000;
const recentOnboardingPrompts = new Map<string, number>();

// Exported so the throttle that keeps the first-contact link send and the
// later disconnected-branch prompt from double-sending can be tested
// directly.
export function claimOnboardingPrompt(key: string): boolean {
  const now = Date.now();
  const last = recentOnboardingPrompts.get(key);
  if (last !== undefined && now - last < ONBOARDING_PROMPT_TTL_MS) return false;
  recentOnboardingPrompts.set(key, now);
  if (recentOnboardingPrompts.size > 500) {
    for (const [entryKey, at] of recentOnboardingPrompts) {
      if (now - at > ONBOARDING_PROMPT_TTL_MS)
        recentOnboardingPrompts.delete(entryKey);
    }
  }
  return true;
}

// The first two bubbles are always sent as-is. The third (an invitation to
// connect Google) and fourth (the authorization link) are conditional: they
// are skipped when Google Workspace is already connected, and the fourth is
// replaced by a fallback message if link generation fails.
export const INTRO_BUBBLES = [
  "I can do lots of things: book flights ✈️, order things 📦, make dinner reservations 📅, send you reminders 🧠, monitor the web for concert tickets 🎙️",
  "I can do all of these things without ever seeing your passwords, so they stay fully private. Best of all, I never forget anything.",
] as const;

export const GOOGLE_SIGN_IN_BUBBLE =
  "First, let's sign into your Google account, which will let me monitor your email for important information, and help you schedule events.";

const GOOGLE_LINK_UNAVAILABLE_BUBBLE =
  "Google sign-in is temporarily unavailable - I'll send the link as soon as it's back.";

type GoogleWorkspaceState = "connected" | "disconnected" | "unavailable";

export type GoogleIntroOutcome = "connected" | "sent" | "failed" | "skipped";

// Posts the four-message first-contact sequence. The Google sign-in prompt
// and link (messages 3 and 4) are only attempted when Google Workspace is
// Only a genuinely connected account skips the sign-in ask. An "unavailable"
// connector still gets the attempt: link generation will throw and the user
// sees GOOGLE_LINK_FAILED_COPY, which is far better than a silently truncated
// two-bubble intro that reads as if Google were never part of the product.
export async function sendIntroSequence(
  context: LinqInboundMessageContext,
  googleWorkspaceState: GoogleWorkspaceState,
  scope: AccessScope
): Promise<GoogleIntroOutcome> {
  for (const bubble of INTRO_BUBBLES) {
    await context.thread.post({ markdown: bubble });
  }

  if (googleWorkspaceState === "connected") return "connected";

  await context.thread.post({ markdown: GOOGLE_SIGN_IN_BUBBLE });

  try {
    // Routes the browser through /internal/google-connect-notify on its way
    // back to /google-connected so the proactive "we're in" message can fire
    // with no session available on that landing page - see
    // lib/google-connect-notify.ts.
    const callbackUrl = buildGoogleConnectNotifyUrl(scope.workspaceId);
    const authorizationUrl = await startGoogleWorkspaceAuthorization(
      scope,
      callbackUrl.toString()
    );
    // Keep this bubble containing only the URL and nothing else: Linq
    // flattens markdown to plain text for iMessage and drops the newlines,
    // so anything trailing the link gets glued into its path and the
    // authorization request 404s.
    await context.thread.post({ markdown: authorizationUrl });
    return "sent";
  } catch {
    await context.thread.post({ markdown: GOOGLE_LINK_UNAVAILABLE_BUBBLE });
    return "failed";
  }
}

// One-time, cold-start-safe first-contact claim. Users who were already active
// before this shipped get the flag backfilled silently instead of a first-run
// intro.
async function claimFirstContact(workspaceId: string): Promise<boolean> {
  if (await hasBeenIntroduced(workspaceId)) return false;
  const priorActivity = await workspaceHasActivity(workspaceId);
  const claimed = await claimIntroduction(workspaceId);
  return claimed && !priorActivity;
}

// Invite gate. Fail-open: never blocks when the flag is off or no invites have
// ever been minted, and always lets through a verified Better Auth user, a
// workspace with existing activity, or a handle that redeemed an invite.
async function shouldBlockUninvited(input: {
  verified: boolean;
  workspaceId: string;
  handle: string | undefined;
}): Promise<boolean> {
  if (!inviteGateEnabled || input.verified) return false;
  if (!(await anyInvitesExist())) return false;
  if (await workspaceHasActivity(input.workspaceId)) return false;
  if (input.handle && (await isHandleInvited(input.handle))) return false;
  return true;
}

// Mirrors the private `firstNonEmptyLine` helper in eve's default Chat SDK
// handler (node_modules/eve/dist/src/public/channels/chat-sdk/chatSdkChannel.js),
// used the same way here: the first non-blank line of a mid-turn message,
// shown as the typing indicator while a tool call runs.
function firstNonEmptyLine(message: string): string | undefined {
  for (const line of message.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export default linqChannel({
  credentials: linqCredentials(),
  events: {
    // eve's default Chat SDK renderer turns an input request into a Card of
    // Buttons; the Linq adapter only emits `text` and `media` parts, so that
    // never shows up over iMessage. Post plain text instead - one bubble per
    // request, matching how the intro sequence posts. A reply that matches
    // an option's id, label, or numeric index still resolves the pending
    // request through eve's normal HITL resume path; this only changes what
    // the user sees while deciding what to type back.
    async "input.requested"(eventData, channel) {
      if (!channel.thread) return;
      for (const request of eventData.requests) {
        await channel.thread.post({ markdown: renderInputRequest(request) });
      }
    },

    // eve's default Chat SDK handler for this event does streamed-message
    // finalization: it posts an anchor message and edits it as tokens
    // arrive, then edits it one last time here. Streaming is hardcoded off
    // for this channel (`streaming: !1` in the compiled
    // node_modules/eve/dist/src/public/channels/linq/linqChannel.js, passed
    // through to chatSdkChannel), so that edit path (`canStream` in
    // node_modules/eve/dist/src/public/channels/chat-sdk/chatSdkChannel.js)
    // can never be reached - the default handler always falls through to
    // posting the whole reply as one `thread.post` call. Overriding this
    // event only changes what happens on that fallback path: instead of one
    // `thread.post`, split the reply so a bare URL line becomes its own
    // bubble (see lib/message-bubbles.ts) and post each segment in order.
    //
    // The other branch of the default handler - `finishReason ===
    // "tool-calls"` - stashes the first non-empty line of a mid-turn message
    // as `pendingToolCallMessage`, which `actions.requested` surfaces as the
    // typing indicator; it never posts. That bookkeeping is preserved
    // as-is below.
    async "message.completed"(eventData, channel) {
      if (eventData.finishReason === "tool-calls") {
        channel.state.pendingToolCallMessage = eventData.message
          ? (firstNonEmptyLine(eventData.message) ?? null)
          : null;
        return;
      }
      channel.state.pendingToolCallMessage = null;
      if (!channel.thread || !eventData.message) return;
      for (const bubble of splitMessageIntoBubbles(eventData.message)) {
        await channel.thread.post({ markdown: bubble });
      }
    },
  },
  async onMessage(context, message) {
    if (message.author.isBot) return null;

    // eve's linqChannel hardcodes an in-memory Chat SDK state adapter with no
    // seam to swap it (see lib/durable-state.ts), so inbound dedup does not
    // survive a cold start on its own. Claim the message id durably in
    // Postgres so a redelivered webhook is handled at most once.
    const messageId =
      typeof (message as { id?: unknown }).id === "string"
        ? (message as { id: string }).id
        : undefined;
    if (messageId) {
      const firstDelivery = await claimOnce("linq-inbound", messageId, {
        ttlMs: 24 * 60 * 60 * 1000,
      });
      if (!firstDelivery) return null;
    }

    const turnContext: string[] = [];
    if (
      Array.isArray(message.attachments) &&
      message.attachments.some(isAudioAttachment)
    ) {
      const ok = await foldVoiceNoteIntoMessage(message);
      if (!ok) {
        await context.thread.post({
          markdown:
            "got your voice note but couldn't make it out - mind typing it?",
        });
        return null;
      }
      turnContext.push(
        "The user's message came in as a voice note; the text above is its transcript."
      );
    }

    const auth = defaultLinqAuth(message);
    const authorUserName: unknown = message.author.userName;
    const phoneNumber =
      typeof authorUserName === "string"
        ? normalizeAuthPhoneNumber(authorUserName)
        : undefined;
    const verifiedUserId = phoneNumber
      ? await findVerifiedAuthUserIdByPhoneNumber(phoneNumber)
      : undefined;
    const principalId = verifiedUserId
      ? `better-auth:${verifiedUserId}`
      : auth.principalId;
    const scope = accessScopeForUser(principalId);

    if (
      await shouldBlockUninvited({
        verified: verifiedUserId !== undefined,
        workspaceId: scope.workspaceId,
        handle: phoneNumber,
      })
    ) {
      await context.thread.post({
        markdown:
          "you need an invite to use Mouse. ask whoever told you about it for a link.",
      });
      return null;
    }

    // Durable, cold-start-safe count of accepted inbound messages for this
    // workspace - paces the contact-card and Shortcut-offer sends below (see
    // lib/paced-onboarding.ts). Placed here, after the invite gate and the
    // voice-note fold above (both of which already returned null on
    // failure), so a message dropped by either never bumps the round: only
    // a message this turn is actually going to process - as the intro, the
    // Google-disconnected prompt, or a normal dispatch - counts as a round.
    const round = await nextRound(scope.workspaceId);

    // Durable per-workspace delivery target, kept fresh on every accepted
    // inbound message (not just the branches below that reach the return
    // statement) so any later authored code - including the onboarding link
    // this same turn may send a few lines down - can resolve a Linq thread
    // to text this workspace back, even before any schedule or monitor row
    // exists. See lib/linq-target.ts.
    await saveDurableLinqTarget({
      authenticator: auth.authenticator,
      issuer: auth.issuer ?? null,
      linqThread: JSON.stringify(context.thread),
      ownerHandle: typeof authorUserName === "string" ? authorUserName : null,
      ownerPrincipalId: principalId,
      workspaceId: scope.workspaceId,
    }).catch((error: unknown) => {
      console.warn("[linq] failed to persist durable delivery target:", error);
    });

    const googleWorkspace = await getGoogleWorkspaceConnection(scope);

    // Gated: this reads the cached pref (a cheap indexed lookup) on every
    // message, but only reaches out to the Calendar API when the stored
    // value is absent, still browser-sourced, or stale - see
    // lib/google-workspace/calendar-timezone.ts. Running it here, before the
    // timezone note below, means a message that arrives just after the user
    // connects Google can pick up the fresh value in the very same turn
    // instead of waiting for the next one.
    let timezonePref = await getUserTimezonePref(scope.workspaceId);
    const syncedTimezone = await syncGoogleCalendarTimezoneIfDue(
      scope,
      googleWorkspace.state,
      timezonePref
    ).catch((error: unknown) => {
      console.warn("[linq] calendar timezone sync failed:", error);
      return null;
    });
    if (syncedTimezone) {
      timezonePref = {
        source: "google_calendar",
        timezone: syncedTimezone,
        updatedAt: new Date().toISOString(),
      };
    }
    const timezone = timezonePref?.timezone ?? null;
    turnContext.push(
      timezone
        ? `The current time is ${new Date().toISOString()} (UTC). The user's timezone is ${timezone} - use it for any time the user mentions.`
        : `The current time is ${new Date().toISOString()} (UTC). The user's timezone is not on file yet - it is usually captured automatically the next time the user opens the web portal, so do not open with asking for it or bring it up as small talk. If the user states their timezone or a location, save it right away with set_timezone. Only ask directly as a last resort, right when you are about to schedule something at a clock time and have no other way to get it.`
    );

    const onboardingContext: string[] = [];

    const justIntroduced = await claimFirstContact(scope.workspaceId);
    if (justIntroduced) {
      // The contact card no longer opens the conversation - it now arrives
      // on round 3 (see lib/paced-onboarding.ts) so a brand-new thread isn't
      // hit with everything at once. This is still round 1.
      const googleOutcome = await sendIntroSequence(
        context,
        googleWorkspace.state,
        scope
      );
      // A successfully sent link claims the same throttle the later
      // disconnected-branch prompt uses, so the very next message doesn't
      // send it again.
      if (googleOutcome === "sent") claimOnboardingPrompt(scope.workspaceId);

      // The intro is the whole first turn. Dropping the message here stops the
      // model from also answering "Hi mouse" with a fifth bubble underneath a
      // sequence that already ends by asking the user to do something. Their
      // next message gets a normal reply.
      return null;
    } else if (googleWorkspace.state === "disconnected") {
      if (claimOnboardingPrompt(scope.workspaceId)) {
        try {
          // See the matching comment in sendIntroSequence: this routes the
          // browser through the notify endpoint so the proactive message can
          // fire without a session on /google-connected.
          const callbackUrl = buildGoogleConnectNotifyUrl(scope.workspaceId);
          const authorizationUrl = await startGoogleWorkspaceAuthorization(
            scope,
            callbackUrl.toString()
          );
          // Keep the URL at the very end with a single leading space and nothing
          // after it: Linq flattens markdown to plain text for iMessage and drops
          // the newlines, so anything trailing the link gets glued into its path
          // and the authorization request 404s.
          await context.thread.post({
            markdown: `to help with your Gmail and Calendar, connect Google Workspace here (the link is good for 10 minutes): ${authorizationUrl}`,
          });
          onboardingContext.push(
            "A Google Workspace authorization link was just sent to the user. Do not repeat the link; respond naturally to their message."
          );
        } catch {
          recentOnboardingPrompts.delete(scope.workspaceId);
          onboardingContext.push(
            "Google Workspace onboarding is temporarily unavailable. Do not claim that Google is connected."
          );
        }
      } else {
        onboardingContext.push(
          "The user has not connected Google Workspace yet and was already sent the link recently. Do not resend it unless they ask; only bring up Google access if it is relevant to their request."
        );
      }
    }

    // Sent last, right before the model's own reply is dispatched below: eve
    // only starts generating that reply once onMessage returns, so this
    // always lands first and reads as a quick aside ahead of the real
    // answer - see lib/paced-onboarding.ts.
    await sendPacedOnboarding(context.thread, scope.workspaceId, round);

    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          workspaceId: scope.workspaceId,
          // Captured so background jobs (web monitors, schedules) can deliver a
          // proactive message back to this iMessage conversation later.
          linqThread: JSON.stringify(context.thread),
          ownerHandle: typeof authorUserName === "string" ? authorUserName : "",
          // Captured so react_to_message can tapback the message that started
          // this turn without the model having to track or pass an id. Scoped
          // to this session's auth only - not part of the durable per-workspace
          // target saved above, which would go stale across turns.
          linqMessageId: messageId ?? "",
        },
        principalId,
      },
      context: [...turnContext, ...onboardingContext],
    };
  },
});

async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const context = await auth.$context;
  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  const parsed = verifiedPhoneUserSchema.safeParse(user);
  return parsed.success ? parsed.data.id : undefined;
}
