import {
  NoValidTokenError,
  type ConnectAuthorizationOptions,
  type ConnectAuthorizationResponse,
  type ConnectOptions,
  type ConnectTokenParams,
  type ConnectTokenResponse,
} from "@vercel/connect";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseCalendarAvailability } from "@/agent/lib/google-workspace/calendar";
import { googleWorkspaceAuthOptions } from "@/agent/lib/google-workspace/client";
import { gmailUpdateLabels } from "@/agent/lib/google-workspace/gmail";
import { googleWorkspaceReadInputSchema } from "@/agent/tools/google_workspace_read";
import { googleWorkspaceWriteInputSchema } from "@/agent/tools/google_workspace_write";
import { googleWorkspaceWriteApproval } from "@/agent/tools/google_workspace_write";
import {
  GOOGLE_WORKSPACE_SCOPES,
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "@/lib/google-workspace/config";
import {
  getGoogleWorkspaceConnection,
  startGoogleWorkspaceAuthorization,
  type GoogleWorkspaceClient,
} from "@/lib/google-workspace/server";

const scope = {
  userId: "better-auth:user-123",
  workspaceId: "personal:workspace-123",
};

describe("Google Workspace connection", () => {
  it("uses Anthropic-compatible object-root tool schemas", () => {
    expect(z.toJSONSchema(googleWorkspaceReadInputSchema).type).toBe("object");
    expect(z.toJSONSchema(googleWorkspaceWriteInputSchema).type).toBe("object");
  });
  it("uses one explicit Gmail, Calendar, and Contacts scope set", () => {
    expect(GOOGLE_WORKSPACE_SCOPES).not.toContain("*");
    // Gmail access deliberately requests the sensitive `gmail.modify` scope,
    // not the restricted `mail.google.com` scope, which includes permanent
    // delete. See the Gmail code: it only searches, reads, labels
    // (batchModify), and sends — nothing that needs full mailbox access.
    expect(GOOGLE_WORKSPACE_SCOPES).not.toContain("https://mail.google.com/");
    expect(GOOGLE_WORKSPACE_SCOPES).toContain(
      "https://www.googleapis.com/auth/gmail.modify"
    );
    expect(GOOGLE_WORKSPACE_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar"
    );
    expect(GOOGLE_WORKSPACE_SCOPES).toContain(
      "https://www.googleapis.com/auth/contacts.readonly"
    );
    expect(googleWorkspaceTokenParams(scope.userId)).toEqual({
      scopes: [...GOOGLE_WORKSPACE_SCOPES],
      subject: googleWorkspaceSubject(scope.userId),
    });
    expect(googleWorkspaceAuthOptions.tokenParams).toEqual({
      scopes: [...GOOGLE_WORKSPACE_SCOPES],
    });
    expect(googleWorkspaceAuthOptions.validate).toBe(true);
  });

  it("uses the same user subject for manager and Eve flows", () => {
    expect(googleWorkspaceSubject(scope.userId)).toEqual({
      id: scope.userId,
      issuer: "openinstinct",
      type: "user",
    });
  });

  it("reports connected accounts without exposing tokens", async () => {
    const response: ConnectTokenResponse = {
      claims: { email: "person@example.com" },
      connector: { id: "connector-id", type: "oauth", uid: "google/test" },
      expiresAt: Date.now() + 60_000,
      token: "must-not-leak",
    };
    let capturedOptions: ConnectOptions | undefined;
    const client = fakeClient(response);
    client.getTokenResponse = async (_connector, _params, options) => {
      capturedOptions = options;
      return response;
    };

    await expect(getGoogleWorkspaceConnection(scope, client)).resolves.toEqual({
      accountLabel: "person@example.com",
      state: "connected",
    });
    expect(capturedOptions).toEqual({ forceRefresh: true });
  });

  it("reports a missing user grant as disconnected", async () => {
    const client = fakeClient(
      new NoValidTokenError("No Google grant for this user.")
    );
    await expect(getGoogleWorkspaceConnection(scope, client)).resolves.toEqual({
      accountLabel: null,
      state: "disconnected",
    });
  });

  it("starts authorization with the canonical subject and scopes", async () => {
    const calls: {
      connector: string;
      options?: ConnectAuthorizationOptions;
      params: ConnectTokenParams;
    }[] = [];
    const client = fakeClient({
      connector: { id: "connector-id", type: "oauth", uid: "google/test" },
      expiresAt: Date.now() + 60_000,
      token: "token",
    });
    client.startAuthorization = async (connector, params, options) => {
      calls.push({ connector, options, params });
      return {
        request: "request",
        url: "https://connect.vercel.com/request",
        verifier: "verifier",
      };
    };

    await expect(
      startGoogleWorkspaceAuthorization(
        scope,
        "https://openinstinct.example/?google=connected",
        client
      )
    ).resolves.toBe("https://connect.vercel.com/request");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.callbackUrl).toBe(
      "https://openinstinct.example/?google=connected"
    );
    expect(calls[0]?.params).toEqual(googleWorkspaceTokenParams(scope.userId));
  });

  it("maps reversible Gmail actions to system labels", () => {
    expect(gmailUpdateLabels("archive")).toEqual({
      addLabelIds: [],
      removeLabelIds: ["INBOX"],
    });
    expect(gmailUpdateLabels("mark_unread")).toEqual({
      addLabelIds: ["UNREAD"],
      removeLabelIds: [],
    });
  });

  it("requires approval for anything that reaches other people", () => {
    expect(googleWorkspaceWriteApproval(undefined)).toBe("not-applicable");
    expect(googleWorkspaceWriteApproval({ action: "send_email" })).toBe(
      "user-approval"
    );
    expect(googleWorkspaceWriteApproval({ action: "update_email" })).toBe(
      "not-applicable"
    );
  });

  it("gates calendar create/update on whether attendees are present", () => {
    expect(
      googleWorkspaceWriteApproval({ action: "create_calendar_event" })
    ).toBe("not-applicable");
    expect(
      googleWorkspaceWriteApproval({
        action: "create_calendar_event",
        attendees: [],
      })
    ).toBe("not-applicable");
    expect(
      googleWorkspaceWriteApproval({
        action: "create_calendar_event",
        attendees: ["friend@example.com"],
      })
    ).toBe("user-approval");
    expect(
      googleWorkspaceWriteApproval({ action: "update_calendar_event" })
    ).toBe("not-applicable");
    // Adding attendees to a previously solo event must also require
    // approval, not just events created with attendees from the start.
    expect(
      googleWorkspaceWriteApproval({
        action: "update_calendar_event",
        attendees: ["friend@example.com"],
      })
    ).toBe("user-approval");
  });

  it("always requires approval for calendar deletes", () => {
    // The approval policy runs before the event is read, so it cannot see
    // whether the event being deleted has attendees. Treat every deletion
    // as a potential guest cancellation.
    expect(
      googleWorkspaceWriteApproval({ action: "delete_calendar_event" })
    ).toBe("user-approval");
  });

  it("does not interpret Google FreeBusy errors as availability", () => {
    expect(() =>
      parseCalendarAvailability({
        calendars: {
          "missing@example.com": {
            errors: [{ domain: "global", reason: "notFound" }],
          },
        },
      })
    ).toThrow(/missing@example\.com: notFound/u);

    expect(
      parseCalendarAvailability({
        calendars: {
          primary: {
            busy: [
              {
                end: "2026-08-27T15:00:00-04:00",
                start: "2026-08-27T14:00:00-04:00",
              },
            ],
          },
        },
      })
    ).toEqual({
      calendars: {
        primary: {
          busy: [
            {
              end: "2026-08-27T15:00:00-04:00",
              start: "2026-08-27T14:00:00-04:00",
            },
          ],
        },
      },
    });
  });
});

function fakeClient(
  result: ConnectTokenResponse | Error
): GoogleWorkspaceClient {
  return {
    async getTokenResponse() {
      if (result instanceof Error) throw result;
      return result;
    },
    revokeToken: () => Promise.resolve(),
    async startAuthorization(): Promise<ConnectAuthorizationResponse> {
      return {
        request: "request",
        url: "https://connect.vercel.com/request",
        verifier: "verifier",
      };
    },
  };
}
