import { mouseContactCardVCard } from "@/lib/contact-card";

// Deliberately not force-static: the card embeds env.LINQ_PHONE_NUMBER, and a
// statically prerendered route bakes in whatever that env var was at build
// time. Verified this the hard way - built once without LINQ_PHONE_NUMBER set,
// then started the server with it set, and the served card still had no TEL
// line. force-dynamic reads the env on every request instead, so a self-hoster
// who sets or changes LINQ_PHONE_NUMBER without a full rebuild still gets a
// correct card.
export const dynamic = "force-dynamic";

/**
 * The vCard for the "Mouse" contact. Reached two ways: as a direct media
 * attachment sent over the Linq thread (see `lib/contact-card.ts`'s
 * `sendContactCard`), and as a plain link a signed-out recipient can tap.
 *
 * This route has to be reachable without a session — whoever opens it is by
 * definition someone who just texted Mouse for the first time and has never
 * signed in — so it is carved out of proxy.ts's auth gate the same way
 * `/vault` and `/icon.png` are. Nothing here reads request state or secrets;
 * the card's only per-deployment input is the LINQ_PHONE_NUMBER env var.
 */
export function GET() {
  const vcard = mouseContactCardVCard();
  return new Response(vcard, {
    headers: {
      // text/vcard is the IANA-registered vCard media type (RFC 6350 §11)
      // and what iOS Contacts/Messages expects; text/x-vcard was the legacy
      // pre-registration type some very old parsers still look for, but a
      // single Content-Type header can only carry one value and iOS is the
      // target here.
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'attachment; filename="Mouse.vcf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
