import type { LinqInboundMessageContext } from "eve/channels/linq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "@/lib/access-scope";

// These tests cover the branching seams in the first-contact intro
// (agent/channels/linq.ts) that have real failure modes: the Google
// sign-in link is now generated inside first contact instead of on a later
// turn, so a bad branch here either leaves the user with a dangling promise
// of a link that never arrives, or sends the link twice. They deliberately
// do not assert the literal marketing copy - only behavior that a future
// edit could silently break.

const mocks = vi.hoisted(() => ({
  startGoogleWorkspaceAuthorization:
    vi.fn<(...args: unknown[]) => Promise<string>>(),
}));

vi.mock("@/lib/google-workspace/server", () => ({
  getGoogleWorkspaceConnection:
    vi.fn<
      (...args: unknown[]) => Promise<{ accountLabel: null; state: string }>
    >(),
  startGoogleWorkspaceAuthorization: mocks.startGoogleWorkspaceAuthorization,
}));

const { sendIntroSequence, claimOnboardingPrompt } =
  await import("@/agent/channels/linq");

function fakeContext() {
  const post = vi.fn<(input: { markdown: string }) => Promise<void>>(() =>
    Promise.resolve()
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stand-in for the Chat SDK thread; only `post` is used by sendIntroSequence
  const context = {
    thread: { post },
  } as unknown as LinqInboundMessageContext;
  return { context, post };
}

function postedBubbles(post: ReturnType<typeof fakeContext>["post"]) {
  return post.mock.calls.map((call) => call[0].markdown);
}

const scope: AccessScope = {
  userId: "user:test",
  workspaceId: "workspace:test",
};

beforeEach(() => {
  mocks.startGoogleWorkspaceAuthorization.mockReset();
});

describe("sendIntroSequence", () => {
  it("skips the Google sign-in prompt and link when already connected", async () => {
    const { context, post } = fakeContext();
    const outcome = await sendIntroSequence(context, "connected", scope);

    expect(outcome).toBe("connected");
    expect(mocks.startGoogleWorkspaceAuthorization).not.toHaveBeenCalled();
    expect(postedBubbles(post)).toHaveLength(2);
  });

  it("stays silent about Google when the connector is unavailable", async () => {
    const { context, post } = fakeContext();
    const outcome = await sendIntroSequence(context, "unavailable", scope);

    expect(outcome).toBe("skipped");
    expect(mocks.startGoogleWorkspaceAuthorization).not.toHaveBeenCalled();
    expect(postedBubbles(post)).toHaveLength(2);
  });

  it("sends the authorization link as its own bubble, with nothing else on it", async () => {
    mocks.startGoogleWorkspaceAuthorization.mockResolvedValue(
      "https://example.com/authorize?token=abc"
    );
    const { context, post } = fakeContext();
    const outcome = await sendIntroSequence(context, "disconnected", scope);

    expect(outcome).toBe("sent");
    const bubbles = postedBubbles(post);
    expect(bubbles).toHaveLength(4);
    // The URL rule (agent/instructions.md): a link bubble must contain only
    // the URL, or Linq's plain-text flattening glues trailing text into the
    // link's path and the authorization request 404s.
    expect(bubbles[3]).toBe("https://example.com/authorize?token=abc");
  });

  it("falls back to a coherent message instead of a dangling link promise when generation fails", async () => {
    mocks.startGoogleWorkspaceAuthorization.mockRejectedValue(
      new Error("connect error")
    );
    const { context, post } = fakeContext();
    const outcome = await sendIntroSequence(context, "disconnected", scope);

    expect(outcome).toBe("failed");
    const bubbles = postedBubbles(post);
    // Two intro bubbles, the sign-in prompt, and a fallback - never three
    // bubbles with silence where the link should be.
    expect(bubbles).toHaveLength(4);
    expect(bubbles[3]).not.toMatch(/^https?:\/\//);
  });
});

describe("claimOnboardingPrompt", () => {
  it("blocks a second claim for the same key within the throttle window", () => {
    const key = `workspace:throttle-${String(Date.now())}`;
    expect(claimOnboardingPrompt(key)).toBe(true);
    // This is what stops the later disconnected-branch prompt from
    // resending the link on the very next message after first contact
    // already sent it.
    expect(claimOnboardingPrompt(key)).toBe(false);
  });

  it("does not throttle unrelated keys", () => {
    const keyA = `workspace:a-${String(Date.now())}`;
    const keyB = `workspace:b-${String(Date.now())}`;
    expect(claimOnboardingPrompt(keyA)).toBe(true);
    expect(claimOnboardingPrompt(keyB)).toBe(true);
  });
});
