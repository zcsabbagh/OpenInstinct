/**
 * The vCard iOS sees when someone first texts Mouse. Without it the thread
 * header is a bare phone number; this gives the thread a name ("Mouse") and
 * a face (the logo) the way any other saved contact would.
 *
 * vCard 3.0, deliberately, not 4.0: iOS Contacts/Messages parses 3.0's
 * `PHOTO;ENCODING=b;TYPE=PNG:<base64>` reliably, while 4.0's `PHOTO:data:...`
 * data-URI form is the newer, less universally-supported spelling. 3.0 is
 * also what every other guide for "text a vCard to iOS" settles on.
 */
import { MOUSE_LOGO_DATA_URL } from "@/app/vault/mouse-logo";
import type { LinqInboundMessageContext } from "eve/channels/linq";
import { env } from "@/lib/env";
import { toDialableNumber } from "@/lib/imessage-link";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/**
 * Reuses the same 440x440 transparent-PNG constant the vault Open Graph card
 * embeds, rather than adding a third copy of the artwork (e.g. reading
 * `app/icon.png` off disk). That module is inlined at build time specifically
 * because `fs.readFileSync` off `process.cwd()` is fragile under Vercel's
 * file tracing at request time (see its own header comment) — the same
 * fragility would bite a request-time read of `app/icon.png` here. 440x440
 * is larger than the 256x256 `app/icon.png`, but it costs nothing extra at
 * request time (it's already a compiled-in string) and is still a completely
 * ordinary contact-photo resolution — iOS scales it down for the thread
 * avatar and Contacts detail view either way.
 */
function mouseLogoPngBase64(): string {
  if (!MOUSE_LOGO_DATA_URL.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error("MOUSE_LOGO_DATA_URL is not a base64 PNG data URL");
  }
  return MOUSE_LOGO_DATA_URL.slice(PNG_DATA_URL_PREFIX.length);
}

/**
 * Folds a vCard content line to RFC 2425 §5.8.1's 75-octet limit (CRLF
 * excluded): the first physical line carries up to 75 octets, and each
 * continuation line opens with a single leading space that itself counts
 * against that line's 75-octet budget (parsers unfold by deleting every
 * "CRLF " sequence). Every value this module folds — the property names,
 * the phone number, the base64 PHOTO payload — is pure ASCII, so counting
 * JS string units is the same as counting octets; that's assumed here, not
 * generalized to arbitrary UTF-8 text.
 *
 * Skipping this is exactly the kind of thing that breaks silently: unfolded,
 * a several-KB PHOTO line either gets truncated by clients that cap line
 * length, or fails to parse as base64 once truncated, and the contact photo
 * just never renders — with no error, on some clients only.
 */
export function foldVCardLine(line: string): string {
  const FIRST_LINE_LIMIT = 75;
  const CONTINUATION_LIMIT = 74; // 75 minus the mandatory leading space
  if (line.length <= FIRST_LINE_LIMIT) return line;

  const segments = [line.slice(0, FIRST_LINE_LIMIT)];
  let rest = line.slice(FIRST_LINE_LIMIT);
  while (rest.length > 0) {
    segments.push(` ${rest.slice(0, CONTINUATION_LIMIT)}`);
    rest = rest.slice(CONTINUATION_LIMIT);
  }
  return segments.join("\r\n");
}

/**
 * Builds the "Mouse" vCard. `phoneNumber` is optional and typically
 * `env.LINQ_PHONE_NUMBER`: a self-hoster who hasn't configured a Linq number
 * yet still gets a valid card with a name and a photo, just without a TEL
 * line — no crash, no broken card, one fewer field.
 */
export function buildContactCardVCard(phoneNumber: string | undefined): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", "FN:Mouse", "N:Mouse;;;;"];

  const dialable = toDialableNumber(phoneNumber);
  if (dialable) lines.push(`TEL;TYPE=CELL,VOICE:${dialable}`);

  lines.push(`PHOTO;ENCODING=b;TYPE=PNG:${mouseLogoPngBase64()}`);
  lines.push("END:VCARD");

  return `${lines.map(foldVCardLine).join("\r\n")}\r\n`;
}

/** The card as configured for this deployment. */
export function mouseContactCardVCard(): string {
  return buildContactCardVCard(env.LINQ_PHONE_NUMBER);
}

type LinqThread = LinqInboundMessageContext["thread"];

/**
 * Posts the contact card into a Linq thread as a native `.vcf` attachment
 * rather than a link. The Linq Chat SDK adapter's outbound media path
 * uploads arbitrary attachment bytes with an explicit `mimeType` — it isn't
 * restricted to images/video (its own extension-to-MIME table maps `.vcf` to
 * `text/vcard` alongside pdf/csv/docx/etc, see
 * `node_modules/eve/dist/src/compiled/@linqapp/chat-sdk-adapter/index.js`).
 * Sending bytes directly (vs. a `url` attachment pointing at the `/contact.vcf`
 * route) avoids depending on that route being publicly reachable from
 * wherever Linq's servers fetch from, and skips a redundant network hop.
 *
 * Called from `lib/paced-onboarding.ts` on the user's 3rd accepted inbound
 * message, not on first contact - see that module for why.
 */
export async function sendContactCard(thread: LinqThread): Promise<void> {
  const vcard = mouseContactCardVCard();
  // oxlint-disable-next-line typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Same root cause as agent/channels/linq.ts's file-level disable: LinqInboundMessageContext["thread"] resolves through eve's chat/index.d.ts, which re-exports Thread from a "messages-*.js" chunk the published eve package doesn't ship, so `thread` checks as unresolvable here.
  await thread.post({
    markdown: "btw, add my contact info for easier access",
    attachments: [
      {
        data: new TextEncoder().encode(vcard),
        mimeType: "text/vcard",
        name: "Mouse.vcf",
      },
    ],
  });
}
