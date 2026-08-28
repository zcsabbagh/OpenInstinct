import { describe, expect, it, vi } from "vitest";
import {
  buildContactCardVCard,
  foldVCardLine,
  sendContactCard,
} from "../lib/contact-card";
import { env } from "../lib/env";

describe("foldVCardLine", () => {
  it("leaves a short line untouched", () => {
    expect(foldVCardLine("FN:Mouse")).toBe("FN:Mouse");
  });

  it("leaves a line exactly at the 75-octet limit untouched", () => {
    const line = `X:${"a".repeat(73)}`; // 2 + 73 = 75
    expect(line.length).toBe(75);
    expect(foldVCardLine(line)).toBe(line);
  });

  it("folds a line one octet over the limit into two physical lines", () => {
    const line = `X:${"a".repeat(74)}`; // 76 octets
    const folded = foldVCardLine(line);
    const physicalLines = folded.split("\r\n");
    expect(physicalLines).toHaveLength(2);
    expect(physicalLines[0]?.length).toBe(75);
    // Continuation line: one leading space + remaining octet.
    expect(physicalLines[1]).toBe(" a");
  });

  it("keeps every physical line at or under 75 octets and prefixes continuations with a single space", () => {
    const value = "b".repeat(400);
    const folded = foldVCardLine(`PHOTO;ENCODING=b;TYPE=PNG:${value}`);
    const physicalLines = folded.split("\r\n");
    expect(physicalLines.length).toBeGreaterThan(1);
    for (const physicalLine of physicalLines) {
      expect(physicalLine.length).toBeLessThanOrEqual(75);
    }
    const continuationLines = physicalLines.slice(1);
    expect(
      continuationLines.every((physicalLine) => physicalLine.startsWith(" "))
    ).toBe(true);
  });

  it("round-trips through the standard vCard unfold algorithm (strip CRLF + one leading space)", () => {
    const value = "c".repeat(500);
    const original = `PHOTO;ENCODING=b;TYPE=PNG:${value}`;
    const folded = foldVCardLine(original);
    const unfolded = folded.replaceAll("\r\n ", "");
    expect(unfolded).toBe(original);
  });
});

describe("buildContactCardVCard", () => {
  it("produces a valid vCard 3.0 with FN, a folded PHOTO, and no TEL when the number is unset", () => {
    const vcard = buildContactCardVCard(undefined);

    expect(vcard.startsWith("BEGIN:VCARD\r\n")).toBe(true);
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
    expect(vcard).toContain("VERSION:3.0\r\n");
    expect(vcard).toContain("FN:Mouse\r\n");
    const unfoldedNoTel = vcard.replaceAll("\r\n ", "");
    expect(
      unfoldedNoTel.split("\r\n").some((line) => line.startsWith("TEL"))
    ).toBe(false);
    // Every physical line must respect the 75-octet fold limit.
    for (const physicalLine of vcard.split("\r\n")) {
      expect(physicalLine.length).toBeLessThanOrEqual(75);
    }
  });

  it("includes a normalized TEL line when a phone number is configured", () => {
    const vcard = buildContactCardVCard("(206) 271-0710");
    expect(vcard).toContain("TEL;TYPE=CELL,VOICE:2062710710\r\n");
  });

  it("keeps a leading + on an E.164 number", () => {
    const vcard = buildContactCardVCard("+12062710710");
    expect(vcard).toContain("TEL;TYPE=CELL,VOICE:+12062710710\r\n");
  });

  it("embeds a PHOTO whose unfolded base64 decodes back to a valid PNG", () => {
    const vcard = buildContactCardVCard(undefined);
    const unfolded = vcard.replaceAll("\r\n ", "");
    const photoLine = unfolded
      .split("\r\n")
      .find((line) => line.startsWith("PHOTO;"));
    if (!photoLine) throw new Error("Expected a PHOTO line in the vCard.");

    const base64 = photoLine.slice(photoLine.indexOf(":") + 1);
    const bytes = Buffer.from(base64, "base64");
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });
});

interface PostedContactCardMessage {
  markdown: string;
  attachments: { data: Uint8Array; mimeType: string; name: string }[];
}

describe("sendContactCard", () => {
  it("posts the vCard as a text/vcard media attachment named Mouse.vcf", async () => {
    const post = vi.fn<(message: PostedContactCardMessage) => Promise<void>>(
      () => Promise.resolve()
    );

    await sendContactCard({ post });

    expect(post).toHaveBeenCalledTimes(1);
    const [message] = post.mock.calls[0] ?? [];
    if (!message) throw new Error("Expected post() to have been called.");

    expect(typeof message.markdown).toBe("string");
    expect(message.markdown.length).toBeGreaterThan(0);
    expect(message.attachments).toHaveLength(1);

    const [attachment] = message.attachments;
    expect(attachment?.mimeType).toBe("text/vcard");
    expect(attachment?.name).toBe("Mouse.vcf");
    if (!attachment) throw new Error("Expected one attachment.");

    const posted = Buffer.from(attachment.data).toString("utf8");
    expect(posted.startsWith("BEGIN:VCARD\r\n")).toBe(true);
    expect(posted).toBe(buildContactCardVCard(env.LINQ_PHONE_NUMBER));
  });
});
