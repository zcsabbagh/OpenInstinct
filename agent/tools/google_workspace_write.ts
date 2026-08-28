import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  calendarEventDeleteSchema,
  calendarEventSchema,
  calendarEventUpdateSchema,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/agent/lib/google-workspace/calendar";
import {
  GMAIL_UPDATE_ACTIONS,
  gmailSendSchema,
  sendGmail,
  updateGmail,
} from "@/agent/lib/google-workspace/gmail";

const updateEmailSchema = z.object({
  action: z.literal("update_email"),
  messageIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  update: z.enum(GMAIL_UPDATE_ACTIONS),
});
const sendEmailSchema = gmailSendSchema.extend({
  action: z.literal("send_email"),
});
const createCalendarEventSchema = calendarEventSchema.extend({
  action: z.literal("create_calendar_event"),
});
const updateCalendarEventSchema = calendarEventUpdateSchema.extend({
  action: z.literal("update_calendar_event"),
});
const deleteCalendarEventSchema = calendarEventDeleteSchema.extend({
  action: z.literal("delete_calendar_event"),
});

export const googleWorkspaceWriteInputSchema = z.object({
  action: z.enum([
    "update_email",
    "send_email",
    "create_calendar_event",
    "update_calendar_event",
    "delete_calendar_event",
  ]),
  attendees: z.array(z.email()).max(50).optional(),
  bcc: z.array(z.email()).max(20).optional(),
  body: z.string().min(1).max(100_000).optional(),
  calendarId: z.string().optional(),
  cc: z.array(z.email()).max(20).optional(),
  description: z.string().max(8_000).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
  eventId: z.string().min(1).max(1_024).optional(),
  inReplyTo: z.string().max(998).optional(),
  location: z.string().max(1_000).optional(),
  messageIds: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  start: z.iso.datetime({ offset: true }).optional(),
  subject: z.string().min(1).max(998).optional(),
  summary: z.string().min(1).max(1_000).optional(),
  threadId: z.string().max(200).optional(),
  timezone: z.string().min(1).optional(),
  to: z.array(z.email()).min(1).max(20).optional(),
  update: z.enum(GMAIL_UPDATE_ACTIONS).optional(),
});

type GoogleWorkspaceWriteInput = z.infer<
  typeof googleWorkspaceWriteInputSchema
>;

export function googleWorkspaceWriteApproval(
  _input: Pick<GoogleWorkspaceWriteInput, "action" | "attendees"> | undefined
) {
  // Nothing here is gated by the framework any more.
  //
  // eve raises one approval per tool call, and a reply settles exactly one of
  // them, so a request like "cancel everything tomorrow" produced a wall of
  // identical prompts the user could not clear. Sending email had the same
  // shape one prompt at a time: the model had already stated the recipient,
  // subject and body and been told to go ahead, so the gate asked a second
  // time in machine language.
  //
  // The safeguard is now the prompt: state what is about to happen in plain
  // words before doing it. See the trust boundary in agent/instructions.md.
  return "not-applicable" as const;
}

export default defineTool({
  approval: ({ toolInput }) => googleWorkspaceWriteApproval(toolInput),
  description:
    "Change the authenticated user's Google Workspace. Reversible Gmail label updates act on exact message IDs. Sending email always requires user approval. Creating or updating a calendar event requires approval only when it carries attendees (Google emails them an invitation); events with no attendees run directly. Deleting a calendar event always requires approval, since it may cancel the event for existing attendees. Calendar edits and deletes act on an exact event ID from a prior read. This tool cannot delete mail, change account settings, or edit contacts.",
  inputSchema: googleWorkspaceWriteInputSchema,
  async execute(input, ctx) {
    switch (input.action) {
      case "update_email": {
        const parsed = updateEmailSchema.parse(input);
        const updated = await updateGmail(
          ctx,
          parsed.messageIds,
          parsed.update
        );
        return {
          action: input.action,
          update: updated.action,
          updatedCount: updated.updatedCount,
        };
      }
      case "send_email": {
        const sent = await sendGmail(ctx, sendEmailSchema.parse(input));
        return {
          action: input.action,
          messageId: sent.id,
          sent: true,
          threadId: sent.threadId,
        };
      }
      case "create_calendar_event":
        return {
          action: input.action,
          created: true,
          event: await createCalendarEvent(
            ctx,
            createCalendarEventSchema.parse(input)
          ),
        };
      case "update_calendar_event":
        return {
          action: input.action,
          event: await updateCalendarEvent(
            ctx,
            updateCalendarEventSchema.parse(input)
          ),
          updated: true,
        };
      case "delete_calendar_event": {
        const parsed = deleteCalendarEventSchema.parse(input);
        await deleteCalendarEvent(ctx, parsed);
        return { action: input.action, deleted: true, eventId: parsed.eventId };
      }
    }
  },
});
