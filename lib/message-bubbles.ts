const URL_LINE = /^https?:\/\/\S+$/u;

/**
 * Splits Mouse's reply text into the ordered iMessage bubbles it should
 * arrive as. `agent/instructions.md` already requires every URL to sit alone
 * on its own line with nothing else on it - this turns that formatting rule
 * into a real message boundary, so a link renders as its own tappable
 * preview instead of being buried mid-paragraph.
 *
 * A line counts as a URL line only when, after trimming, it is nothing but
 * an `http://` or `https://` URL with no internal whitespace. That is
 * deliberately conservative: a URL that appears inside a sentence is left in
 * place, never extracted, since the prompt rule already forbids that shape.
 *
 * Consecutive non-URL lines stay joined by a single newline in their own
 * bubble - this never introduces or removes a blank line, since the format
 * rules already forbid the reply from containing one. A reply with no URL
 * line returns exactly one segment, identical to the input string.
 *
 * Empty or whitespace-only segments (for example, the "before" segment when
 * a reply opens with a link) are dropped rather than posted as blank
 * bubbles.
 */
export function splitMessageIntoBubbles(reply: string): string[] {
  const segments: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const segment = buffer.join("\n");
    buffer = [];
    if (segment.trim().length === 0) return;
    segments.push(segment);
  };

  for (const line of reply.split("\n")) {
    const trimmed = line.trim();
    if (URL_LINE.test(trimmed)) {
      flushBuffer();
      segments.push(trimmed);
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();

  return segments;
}
