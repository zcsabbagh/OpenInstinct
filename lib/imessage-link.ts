/**
 * Deep link back into the iMessage thread with the Linq line.
 *
 * We send people out of the conversation to a web page - the vault setup link,
 * the Google connect callback - and they have to get back. `sms:` alone opens
 * Messages with no recipient, which leaves them to find the thread themselves,
 * so include the number whenever it is configured.
 */
export function messagesHref(rawNumber: string | undefined): string {
  const dialable = toDialableNumber(rawNumber);
  return dialable ? `sms:${dialable}` : "sms:";
}

/**
 * Strips formatting so a phone number is dialable E.164-ish. Exported for
 * other Linq-number consumers (e.g. the contact card's TEL field) that need
 * the same normalization without going through the `sms:` href.
 */
export function toDialableNumber(
  rawNumber: string | undefined
): string | undefined {
  if (!rawNumber) return undefined;
  const trimmed = rawNumber.trim();
  if (!trimmed) return undefined;
  const digits = trimmed.replace(/[^\d]/gu, "");
  if (!digits) return undefined;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}
