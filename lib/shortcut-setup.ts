/**
 * Copy for the "Voice Note To Mouse" Apple Shortcut offer: a two-action
 * shortcut (Record Audio -> Send Message) that lets the user fire a voice
 * note at Mouse from the Action Button, Back Tap, or a Home Screen icon
 * instead of opening the thread by hand. See the design doc this shipped
 * from for the full rationale; the short version lives in the two rules
 * below.
 *
 * The shortcut's exact name, "Voice Note To Mouse" (capitalized as shown),
 * comes from the published shortcut's own iCloud record - it's what the
 * user sees in the Shortcuts app, the Action Button picker, and would say
 * to Siri, so every reference to it here has to match verbatim.
 *
 * The iCloud share link (`https://www.icloud.com/shortcuts/<uuid>`) can only
 * be produced by the Shortcuts app signing a real shortcut on a real device -
 * it can't be fabricated here. `env.MOUSE_SHORTCUT_URL` is therefore
 * optional config, not something this module derives. Unset, a self-hoster
 * who hasn't published one yet still gets a usable feature: plain build
 * steps for the two actions instead of a link.
 *
 * Every string below is plain text on purpose - no markdown, no blank
 * lines, "• " bullets, one bare newline between lines - because Linq
 * flattens markdown and silently drops anything richer (see
 * `agent/instructions.md`).
 */
import { toDialableNumber } from "@/lib/imessage-link";

const SHORTCUT_NAME = "Voice Note To Mouse";

const TRIGGER_STEPS = [
  `• Action Button: Settings, Action Button, swipe to Shortcut, choose ${SHORTCUT_NAME}`,
  `• no Action Button: Settings, Accessibility, Touch, Back Tap, Double Tap, choose ${SHORTCUT_NAME}`,
  "• or add it to your home screen straight from the share sheet",
] as const;

const SIRI_CAVEAT = `skip saying "hey siri, ${SHORTCUT_NAME.toLowerCase()}" for now - Record Audio has a long-standing bug where it freezes at 0:00 when Siri starts it. worth trying on your phone, but use the button if it hangs`;

/**
 * Ready-to-send copy for the proactive round-5 offer sent by
 * `lib/paced-onboarding.ts` - a one-line nudge, not the full setup
 * walkthrough `buildConfiguredShortcutMessage` sends when the user asks for
 * a faster way to reach Mouse via `send_shortcut_setup`. Only called when
 * `env.MOUSE_SHORTCUT_URL` is configured; there is no manual-build-steps
 * variant here, unlike the on-demand tool - an unprompted wall of build
 * steps is not a "quick offer" in the way a one-line link is.
 */
export function buildShortcutNudgeMessage(shortcutUrl: string): string {
  return [
    "also, you can use this shortcut to message me from anywhere. set your action button to this shortcut to talk to me on the go:",
    shortcutUrl,
  ].join("\n");
}

/** Ready-to-send copy when a signed shortcut link is configured. */
export function buildConfiguredShortcutMessage(shortcutUrl: string): string {
  return [
    `want a button for me? tap this to grab ${SHORTCUT_NAME} - it starts recording the second you press it and sends the voice note here the moment you tap to stop`,
    shortcutUrl,
    "open it, tap Get Shortcut, then pick how to fire it",
    ...TRIGGER_STEPS,
    SIRI_CAVEAT,
  ].join("\n");
}

/**
 * Ready-to-send copy when no link is configured: plain build steps for the
 * two actions. `mousePhoneNumber`, when known, goes straight into the
 * Recipients step so the user isn't left guessing what to type.
 */
export function buildManualShortcutMessage(
  mousePhoneNumber: string | undefined
): string {
  const dialable = toDialableNumber(mousePhoneNumber);
  const recipients = dialable
    ? `Recipients: ${dialable}`
    : "Recipients: me - the number you're already texting";

  return [
    "want a button for me? you can build it yourself, it's just two actions",
    "open Shortcuts, tap the + top right, then add these two",
    "• Record Audio - Start Recording: Immediately, Finish Recording: On Tap",
    `• Send Message - Message: Recorded Audio (the variable Record Audio hands you), ${recipients}, then open Show More and turn Show When Run off`,
    `name it ${SHORTCUT_NAME}`,
    "now pick how to fire it",
    ...TRIGGER_STEPS,
    SIRI_CAVEAT,
  ].join("\n");
}
