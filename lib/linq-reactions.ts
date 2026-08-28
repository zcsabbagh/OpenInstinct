import type { SessionContext } from "eve/context";
import { resolveLinqApiKey } from "@/lib/linq";

// Sends an iMessage tapback reaction to a Linq message.
//
// eve's linqChannel exposes no public API for this: `Channel` only offers
// `routes`/`receive`/`turnPolicy`, and `receive` starts a brand-new prompted
// session rather than reacting to an existing message. The capability is
// real, though - Linq's own Chat SDK adapter
// (node_modules/eve/dist/src/compiled/@linqapp/chat-sdk-adapter/index.js)
// implements `addReaction(threadId, messageId, reaction)` by POSTing
// `{ operation: "add", type, custom_emoji? }` to
// `/v3/messages/{messageId}/reactions`, independent of threadId. So this
// calls that same partner API endpoint directly, using the same credential
// resolution the channel itself uses (lib/linq.ts).
//
// The adapter's own normalizer (its `wn` function) maps a handful of word/
// emoji aliases onto Apple's six classic tapback types (love, like, dislike,
// laugh, emphasize, question) and falls back to `{ type: "custom",
// custom_emoji }` for anything else - including a plain unicode emoji, which
// passes through unchanged. That fallback is what makes a checkmark (or any
// other single emoji the classic six don't cover) possible; whether Linq's
// backend actually forwards a "custom" reaction through to iMessage as a
// real tapback has not been verified against a live account from here.

const LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner";

type LinqReactionType =
  | "like"
  | "dislike"
  | "love"
  | "laugh"
  | "emphasize"
  | "question";

// Mirrors the alias table in the Linq adapter's `wn` normalizer, so a
// reaction that maps cleanly onto one of Apple's classic tapback types goes
// out that way instead of always falling back to a raw custom emoji.
const CLASSIC_TAPBACK_BY_EMOJI: Record<string, LinqReactionType> = {
  "👍": "like",
  "👎": "dislike",
  "❤️": "love",
  "❤": "love",
  "😂": "laugh",
  "🤣": "laugh",
  "‼️": "emphasize",
  "‼": "emphasize",
  "❗": "emphasize",
  "❓": "question",
};

function reactionRequestBody(
  reaction: string
): { type: LinqReactionType } | { type: "custom"; custom_emoji: string } {
  const classic = CLASSIC_TAPBACK_BY_EMOJI[reaction];
  return classic
    ? { type: classic }
    : { type: "custom", custom_emoji: reaction };
}

/**
 * A single emoji grapheme - one visible character, not a word or sentence.
 * Anything a person could actually tap as a reaction, checked with
 * `Intl.Segmenter` rather than a code-point count so multi-code-point emoji
 * (skin tones, ZWJ sequences) still count as one.
 */
export function isSingleEmoji(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 8) {
    return false;
  }
  const graphemes = [
    ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value),
  ];
  if (graphemes.length !== 1) return false;
  if (/[\p{L}\p{N}\s]/u.test(value.replace(/️/gu, ""))) return false;
  return /\p{Extended_Pictographic}/u.test(value);
}

/**
 * The message id `agent/channels/linq.ts` stashed in the session's auth
 * attributes at inbound time (see `linqMessageId` there) - the message that
 * started the current turn. `null` when the turn did not originate from an
 * inbound Linq message (e.g. a schedule-triggered session).
 */
export function resolveInboundLinqMessageId(
  ctx: SessionContext
): string | null {
  const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
  const value = caller?.attributes.linqMessageId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Adds `reaction` (a single emoji) as an iMessage tapback on `messageId`. */
export async function sendLinqReaction(
  messageId: string,
  reaction: string
): Promise<void> {
  const apiKey = await resolveLinqApiKey();
  const response = await fetch(
    `${LINQ_API_BASE_URL}/v3/messages/${encodeURIComponent(messageId)}/reactions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "add",
        ...reactionRequestBody(reaction),
      }),
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Linq reaction request failed (${String(response.status)}): ${detail.slice(0, 500)}`
    );
  }
}
