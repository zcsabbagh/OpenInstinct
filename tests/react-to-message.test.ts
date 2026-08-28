import { readFileSync } from "node:fs";
import type { ToolContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import {
  isSingleEmoji,
  resolveInboundLinqMessageId,
} from "@/lib/linq-reactions";

// Covers the two pieces of real logic react_to_message adds: the single-
// emoji input guard (lib/linq-reactions.ts), and the round-trip of the
// message id agent/channels/linq.ts stashes in session auth attributes at
// inbound time back out through resolveInboundLinqMessageId. Does not cover
// the outbound Linq API call itself (sendLinqReaction) - that needs a live
// Linq account to verify and is called out as such in the task report.

describe("isSingleEmoji", () => {
  it("accepts a single emoji, with or without a variation selector", () => {
    expect(isSingleEmoji("✅")).toBe(true);
    expect(isSingleEmoji("👍")).toBe(true);
    expect(isSingleEmoji("❤️")).toBe(true);
    expect(isSingleEmoji("🎉")).toBe(true);
  });

  it("rejects words, punctuation, digits, and empty input", () => {
    expect(isSingleEmoji("done")).toBe(false);
    expect(isSingleEmoji("ok!")).toBe(false);
    expect(isSingleEmoji("!")).toBe(false);
    expect(isSingleEmoji("123")).toBe(false);
    expect(isSingleEmoji("")).toBe(false);
  });

  it("rejects more than one emoji", () => {
    expect(isSingleEmoji("✅✅")).toBe(false);
    expect(isSingleEmoji("👍🎉")).toBe(false);
  });
});

function fakeCtx(attributes: Record<string, string>): ToolContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stand-in for eve's ToolContext; only ctx.session.auth is read
  return {
    session: {
      auth: {
        current: {
          principalType: "user",
          principalId: "linq:1",
          authenticator: "linq",
          issuer: null,
          attributes,
        },
        initiator: undefined,
      },
    },
  } as unknown as ToolContext;
}

describe("resolveInboundLinqMessageId", () => {
  it("round-trips the linqMessageId stashed by agent/channels/linq.ts", () => {
    expect(
      resolveInboundLinqMessageId(fakeCtx({ linqMessageId: "msg-123" }))
    ).toBe("msg-123");
  });

  it("returns null when the turn did not start from an inbound message", () => {
    expect(resolveInboundLinqMessageId(fakeCtx({}))).toBeNull();
    expect(
      resolveInboundLinqMessageId(fakeCtx({ linqMessageId: "" }))
    ).toBeNull();
  });
});

describe("react_to_message tool", () => {
  it("rejects a non-emoji reaction before doing anything else", async () => {
    const { default: reactToMessageTool } =
      await import("@/agent/tools/react_to_message");
    await expect(
      reactToMessageTool.execute(
        { reaction: "done" },
        fakeCtx({ linqMessageId: "msg-123" })
      )
    ).rejects.toThrow(/single emoji/);
  });

  it("rejects when the turn has no inbound message to react to", async () => {
    const { default: reactToMessageTool } =
      await import("@/agent/tools/react_to_message");
    await expect(
      reactToMessageTool.execute({ reaction: "✅" }, fakeCtx({}))
    ).rejects.toThrow(/No inbound message/);
  });
});

// Regression guard for the actual production failure: the tool and its
// registered instructions bullet were fine (react_to_message id-round-trips
// correctly and shows up in `eve info --json`'s discovered tool list), but
// both described reacting only as something the model decides to do on its
// own to acknowledge a completed action - never as something to do because
// the user directly asked. A user saying "react to this msg" doesn't match
// either description, so the model declined and invented a limitation
// ("that's on your end"). These assertions keep both surfaces explicit that
// a direct user request is itself a valid reason to react, and keep the
// instructions bullet from reverting to conditional "when available"
// phrasing that reads as though the tool might not be present this turn.
describe("react_to_message is described as usable on direct request", () => {
  it("the tool description covers a direct user request to react", async () => {
    const { default: reactToMessageTool } =
      await import("@/agent/tools/react_to_message");
    expect(reactToMessageTool.description).toMatch(
      /user directly asks.*react/i
    );
  });

  it("the instructions bullet covers a direct user request to react, unconditionally", () => {
    const instructions = readFileSync("agent/instructions.md", "utf8");
    const bullet = instructions
      .split("\n")
      .find((line) => line.includes("react_to_message"));
    expect(bullet).toBeDefined();
    expect(bullet).toMatch(/user directly asks.*react/i);
    expect(bullet).not.toMatch(/when `react_to_message` is available/i);
  });
});
