/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-argument, typescript/no-unsafe-type-assertion -- Eve's Linq adapter exposes the thread and message through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import { defaultLinqAuth, linqChannel } from "eve/channels/linq";
import { z } from "zod";
import { auth } from "@/auth";
import { accessScopeForUser } from "@/lib/access-scope";
import { env } from "@/lib/env";
import {
  getGoogleWorkspaceConnection,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";
import { LINQ_CONNECTOR } from "@/lib/linq";
import { normalizeAuthPhoneNumber } from "@/lib/auth/phone-number";
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

function claimOnboardingPrompt(key: string): boolean {
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
    const googleWorkspace = await getGoogleWorkspaceConnection(scope);
    const onboardingContext: string[] = [];

    if (googleWorkspace.state === "disconnected") {
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
            markdown: `Welcome to Mouse! To help with your Gmail and Calendar, connect Google Workspace with this link (good for 10 minutes): ${authorizationUrl}`,
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
