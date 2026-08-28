import { describe, expect, it } from "vitest";
import {
  buildConfiguredShortcutMessage,
  buildManualShortcutMessage,
} from "../lib/shortcut-setup";

describe("shortcut setup copy", () => {
  it("puts the configured link alone on its own line", () => {
    const url = "https://www.icloud.com/shortcuts/abc123";
    const message = buildConfiguredShortcutMessage(url);
    const lines = message.split("\n");

    expect(lines).toContain(url);
    expect(message).not.toContain("\n\n");
    expect(message).not.toMatch(/[*_#`]/u);
  });

  it("falls back to manual build steps with the known number when no link is configured", () => {
    const message = buildManualShortcutMessage("+12065550100");

    expect(message).toContain("Recipients: +12065550100");
    expect(message).not.toContain("\n\n");
    expect(message).not.toMatch(/[*_#`]/u);
  });

  it("still returns usable manual steps with no Mouse number on file", () => {
    const message = buildManualShortcutMessage(undefined);

    expect(message).toContain(
      "Recipients: me - the number you're already texting"
    );
    expect(message).not.toContain("\n\n");
  });
});
