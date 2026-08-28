import type { InputRequest } from "eve/client";
import { describe, expect, it } from "vitest";
import { renderInputRequest } from "@/lib/hitl-prompt";

function request(overrides: Partial<InputRequest>): InputRequest {
  return {
    action: {
      callId: "call_1",
      input: {},
      kind: "tool-call",
      toolName: "ask_question",
    },
    kind: "question",
    prompt: "which one?",
    requestId: "req_1",
    ...overrides,
  };
}

function approvalRequest(
  toolName: string,
  input: InputRequest["action"]["input"]
): InputRequest {
  return request({
    action: { callId: "call_1", input, kind: "tool-call", toolName },
    kind: "tool-approval",
    options: [
      { id: "approve", label: "Approve" },
      { id: "cancel", label: "Cancel" },
    ],
    prompt: `Approve tool call: ${toolName}`,
  });
}

describe("renderInputRequest", () => {
  it("renders a freeform question as the bare prompt", () => {
    expect(
      renderInputRequest(
        request({ allowFreeform: true, prompt: "  what's your first name?  " })
      )
    ).toBe("what's your first name?");
  });

  it("numbers options one per line with a space, no period", () => {
    expect(
      renderInputRequest(
        request({
          options: [
            { id: "a", label: "7:15 showtime" },
            { id: "b", label: "9:40 showtime" },
          ],
          prompt: "which showtime?",
        })
      )
    ).toBe("which showtime?\n\n1 7:15 showtime\n2 9:40 showtime");
  });

  it("never emits markdown or the eve-session-UI fallback", () => {
    const rendered = renderInputRequest(
      request({ allowFreeform: true, prompt: "what's the code?" })
    );
    expect(rendered).not.toMatch(/[*_#`]|eve session UI/u);
  });

  it("describes a send_email approval from the actual call, not the tool name", () => {
    const rendered = renderInputRequest(
      approvalRequest("google_workspace_write", {
        action: "send_email",
        body: "What's up bestie",
        subject: "hello my friend",
        to: ["sabbagh@stanford.edu"],
      })
    );
    expect(rendered).toBe(
      'send to sabbagh@stanford.edu, subject "hello my friend": What\'s up bestie\n\n1 Approve\n2 Cancel'
    );
    expect(rendered).not.toContain("google_workspace_write");
  });

  it("describes a calendar create/update approval with attendees and time", () => {
    const rendered = renderInputRequest(
      approvalRequest("google_workspace_write", {
        action: "create_calendar_event",
        attendees: ["friend@example.com"],
        end: "2026-08-27T15:00:00-04:00",
        start: "2026-08-27T14:00:00-04:00",
        summary: "Coffee",
      })
    );
    expect(rendered.startsWith('create "Coffee"')).toBe(true);
    expect(rendered).toContain("inviting friend@example.com");
    expect(rendered).not.toContain("google_workspace_write");
  });

  it("describes a calendar delete without naming the event it cannot see", () => {
    const rendered = renderInputRequest(
      approvalRequest("google_workspace_write", {
        action: "delete_calendar_event",
        eventId: "abc123",
      })
    );
    expect(rendered.startsWith("cancel this calendar event?")).toBe(true);
    expect(rendered).not.toContain("google_workspace_write");
  });

  it("falls back to the framework prompt for an unrecognized action or tool", () => {
    expect(
      renderInputRequest(
        approvalRequest("google_workspace_write", { action: "update_email" })
      )
    ).toBe("Approve tool call: google_workspace_write\n\n1 Approve\n2 Cancel");
    expect(renderInputRequest(approvalRequest("refund_charge", {}))).toBe(
      "Approve tool call: refund_charge\n\n1 Approve\n2 Cancel"
    );
  });
});
