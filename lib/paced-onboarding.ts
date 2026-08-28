/**
 * Spreads first-contact onboarding out across a user's first several texts
 * instead of front-loading it all into the very first exchange. "Round N"
 * means the Nth accepted inbound message from a workspace - first contact
 * (the staged intro `agent/channels/linq.ts` sends) is round 1. The contact
 * card lands on round 3, the Shortcut offer on round 5.
 *
 * `nextRound` is called once per accepted inbound message (see the call
 * site in `agent/channels/linq.ts` for exactly which messages count).
 * `sendPacedOnboarding` is then called with that round number and decides
 * what, if anything, to send.
 *
 * Both sends check "at or past the threshold, and not yet sent" rather than
 * `round === threshold`: a burst of messages, or a redelivered webhook
 * collapsing several rounds into one durable increment, can jump the
 * counter past a threshold in a single hop, and a strict equality check
 * would then never fire again. `claimOnce` (`lib/durable-state.ts`) is what
 * actually guarantees each send happens at most once per workspace even
 * though the threshold check itself can pass on more than one message.
 */
import type { LinqInboundMessageContext } from "eve/channels/linq";
import { sendContactCard } from "@/lib/contact-card";
import { claimOnce, incrementCounter } from "@/lib/durable-state";
import { env } from "@/lib/env";
import { buildShortcutNudgeMessage } from "@/lib/shortcut-setup";

const ROUND_COUNTER_NAMESPACE = "linq-round-count";
const CONTACT_CARD_CLAIM_NAMESPACE = "linq-round-contact-card";
const SHORTCUT_OFFER_CLAIM_NAMESPACE = "linq-round-shortcut-offer";

const CONTACT_CARD_ROUND = 3;
const SHORTCUT_OFFER_ROUND = 5;

/**
 * Durable, per-workspace count of accepted inbound messages. Backed by
 * `channel_state` (via `incrementCounter`), so it survives a cold start
 * unlike an in-memory counter would. Returns this message's round number.
 */
export async function nextRound(workspaceId: string): Promise<number> {
  return await incrementCounter(ROUND_COUNTER_NAMESPACE, workspaceId);
}

type LinqThread = LinqInboundMessageContext["thread"];

/**
 * Sends whichever paced-onboarding bubble `round` has newly reached, each at
 * most once per workspace ever. Call this just before returning the normal
 * dispatch payload from `onMessage`: eve only starts generating the model's
 * own reply once `onMessage` returns, so a bubble sent here always lands in
 * the thread before that reply does - it reads as a quick aside ahead of the
 * real answer, not an interruption of it.
 */
export async function sendPacedOnboarding(
  thread: LinqThread,
  workspaceId: string,
  round: number
): Promise<void> {
  if (
    round >= CONTACT_CARD_ROUND &&
    (await claimOnce(CONTACT_CARD_CLAIM_NAMESPACE, workspaceId))
  ) {
    await sendContactCard(thread);
  }

  // No MOUSE_SHORTCUT_URL means skip entirely rather than fall back to
  // manual build steps - see buildShortcutNudgeMessage. Deliberately does
  // not claim the guard in that case, so a workspace that hits round 5
  // before a self-hoster has published a shortcut link still gets the offer
  // on its next accepted message once one is configured.
  if (
    round >= SHORTCUT_OFFER_ROUND &&
    env.MOUSE_SHORTCUT_URL &&
    (await claimOnce(SHORTCUT_OFFER_CLAIM_NAMESPACE, workspaceId))
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Same root cause as lib/contact-card.ts's disable: LinqInboundMessageContext["thread"] resolves through eve's chat/index.d.ts, which re-exports Thread from a "messages-*.js" chunk the published eve package doesn't ship, so `thread` checks as unresolvable here.
    await thread.post({
      markdown: buildShortcutNudgeMessage(env.MOUSE_SHORTCUT_URL),
    });
  }
}
