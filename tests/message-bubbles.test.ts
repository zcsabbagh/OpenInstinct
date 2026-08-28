import { describe, expect, it } from "vitest";
import { splitMessageIntoBubbles } from "@/lib/message-bubbles";

describe("splitMessageIntoBubbles", () => {
  it("passes a reply with no URL through as exactly one bubble, unchanged", () => {
    const reply = "no links in this one\njust a couple lines of text";
    expect(splitMessageIntoBubbles(reply)).toEqual([reply]);
  });

  it("keeps a single-line reply with no URL as one bubble, unchanged", () => {
    expect(splitMessageIntoBubbles("booked - table for two at 7:30")).toEqual([
      "booked - table for two at 7:30",
    ]);
  });

  it("splits off a leading link into its own bubble", () => {
    const reply = "https://example.com/a\nhere's the link you wanted";
    expect(splitMessageIntoBubbles(reply)).toEqual([
      "https://example.com/a",
      "here's the link you wanted",
    ]);
  });

  it("splits off a trailing link into its own bubble", () => {
    const reply = "here's the link you wanted\nhttps://example.com/a";
    expect(splitMessageIntoBubbles(reply)).toEqual([
      "here's the link you wanted",
      "https://example.com/a",
    ]);
  });

  it("keeps a link between two paragraphs as three ordered bubbles", () => {
    const reply = "first paragraph\nhttps://example.com/a\nsecond paragraph";
    expect(splitMessageIntoBubbles(reply)).toEqual([
      "first paragraph",
      "https://example.com/a",
      "second paragraph",
    ]);
  });

  it("splits several consecutive URL lines into separate bubbles", () => {
    const reply =
      "https://example.com/a\nhttps://example.com/b\nhttps://example.com/c";
    expect(splitMessageIntoBubbles(reply)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });

  it("preserves multi-line text segments joined by a single newline", () => {
    const reply =
      "line one\nline two\nhttps://example.com/a\nline three\nline four";
    expect(splitMessageIntoBubbles(reply)).toEqual([
      "line one\nline two",
      "https://example.com/a",
      "line three\nline four",
    ]);
  });

  it("drops a whitespace-only segment instead of posting an empty bubble", () => {
    const reply = "https://example.com/a\n   \nhttps://example.com/b";
    expect(splitMessageIntoBubbles(reply)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("trims incidental whitespace off an isolated URL line", () => {
    const reply = "some text\n  https://example.com/a  \nmore text";
    expect(splitMessageIntoBubbles(reply)).toEqual([
      "some text",
      "https://example.com/a",
      "more text",
    ]);
  });

  it("leaves a URL alone when it appears inside a sentence", () => {
    const reply = "check https://example.com/a for details";
    expect(splitMessageIntoBubbles(reply)).toEqual([reply]);
  });

  it("returns no segments for an empty reply", () => {
    expect(splitMessageIntoBubbles("")).toEqual([]);
  });
});
