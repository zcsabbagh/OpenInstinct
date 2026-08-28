/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-argument, typescript/no-unsafe-type-assertion -- Eve's Linq adapter exposes the thread and message through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import {
  defaultLinqAuth,
  type LinqInboundMessageContext,
  linqChannel,
} from "eve/channels/linq";
import { z } from "zod";
import { auth } from "@/auth";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { claimOnce } from "@/lib/durable-state";
import { env, inviteGateEnabled } from "@/lib/env";
import {
  getGoogleWorkspaceConnection,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";
import {
  anyInvitesExist,
  isHandleInvited,
  workspaceHasActivity,
} from "@/lib/invites";
import { LINQ_CONNECTOR } from "@/lib/linq";
import { normalizeAuthPhoneNumber } from "@/lib/auth/phone-number";
import {
  claimIntroduction,
  getUserTimezone,
  hasBeenIntroduced,
} from "@/lib/user-prefs";
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
// "disconnected" - a verified/connected user isn't told to sign in again, and
// an "unavailable" connector (not installed, or an unexpected error) stays
// silent here just like the later disconnected-only prompt below.
export async function sendIntroSequence(
  context: LinqInboundMessageContext,
  googleWorkspaceState: GoogleWorkspaceState,
  scope: AccessScope
): Promise<GoogleIntroOutcome> {
  for (const bubble of INTRO_BUBBLES) {
    await context.thread.post({ markdown: bubble });
  }

  if (googleWorkspaceState === "connected") return "connected";
  if (googleWorkspaceState !== "disconnected") return "skipped";

  await context.thread.post({ markdown: GOOGLE_SIGN_IN_BUBBLE });

  try {
    const callbackUrl = new URL("/google-connected", env.BETTER_AUTH_URL);
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

export default linqChannel({
  credentials:
    env.LINQ_API_KEY && env.LINQ_WEBHOOK_SECRET
      ? {
          apiKey: env.LINQ_API_KEY,
          signingSecret: env.LINQ_WEBHOOK_SECRET,
        }
      : connectLinqCredentials(LINQ_CONNECTOR),
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

    const timezone = await getUserTimezone(scope.workspaceId);
    turnContext.push(
      timezone
        ? `The current time is ${new Date().toISOString()} (UTC). The user's timezone is ${timezone} - use it for any time the user mentions.`
        : `The current time is ${new Date().toISOString()} (UTC). The user's timezone is not on file yet - it is usually captured automatically the next time the user opens the web portal, so do not open with asking for it or bring it up as small talk. If the user states their timezone or a location, save it right away with set_timezone. Only ask directly as a last resort, right when you are about to schedule something at a clock time and have no other way to get it.`
    );

    const googleWorkspace = await getGoogleWorkspaceConnection(scope);
    const onboardingContext: string[] = [];

    const justIntroduced = await claimFirstContact(scope.workspaceId);
    if (justIntroduced) {
      const googleOutcome = await sendIntroSequence(
        context,
        googleWorkspace.state,
        scope
      );
      // A successfully sent link claims the same throttle the later
      // disconnected-branch prompt uses, so the very next message doesn't
      // send it again.
      if (googleOutcome === "sent") claimOnboardingPrompt(scope.workspaceId);

      const googleIntroContext: Record<GoogleIntroOutcome, string> = {
        connected:
          "Google Workspace is already connected, so the intro skipped the sign-in prompt and link entirely.",
        sent: "The fourth message was the Google Workspace authorization link (good for 10 minutes). Do not repeat the link; respond naturally to their message.",
        failed:
          "A sign-in prompt was sent, but the Google Workspace authorization link failed to generate, so the user was told sign-in is temporarily unavailable instead of getting a link. Do not claim that Google is connected or that a link was sent.",
        skipped:
          "Google Workspace onboarding was not brought up because it is temporarily unavailable. Do not claim that Google is connected.",
      };

      onboardingContext.push(
        `This is the user's very first message. A staged intro was just sent as separate bubbles: (1) what you can do - booking flights, ordering things, dinner reservations, reminders, and monitoring the web for concert tickets, (2) that you never see their passwords and never forget anything. ${googleIntroContext[googleOutcome]} Do not repeat any of that intro copy. Respond to what they actually said.`
      );
    } else if (googleWorkspace.state === "disconnected") {
      if (claimOnboardingPrompt(scope.workspaceId)) {
        try {
          const callbackUrl = new URL("/google-connected", env.BETTER_AUTH_URL);
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
