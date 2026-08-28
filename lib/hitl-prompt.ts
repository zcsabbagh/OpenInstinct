import type { InputRequest } from "eve/client";

const GOOGLE_WORKSPACE_WRITE_TOOL = "google_workspace_write";
const BODY_PREVIEW_MAX = 300;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;
}

function formatEventTime(start: unknown, end: unknown): string | undefined {
  const startValue = asString(start);
  if (!startValue) return undefined;
  const startDate = new Date(startValue);
  if (Number.isNaN(startDate.getTime())) return undefined;
  const startLabel = startDate.toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
  const endValue = asString(end);
  if (!endValue) return startLabel;
  const endDate = new Date(endValue);
  if (Number.isNaN(endDate.getTime())) return startLabel;
  const endLabel = endDate.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startLabel}-${endLabel}`;
}

/**
 * Builds a human-readable approval prompt for a `google_workspace_write`
 * call from its actual arguments, instead of eve's default
 * "Approve tool call: google_workspace_write" (see
 * `node_modules/eve/dist/src/harness/input-extraction.js`, which hardcodes
 * that prompt with no per-tool override). Since the tool's approval policy
 * (`googleWorkspaceWriteApproval` in `agent/tools/google_workspace_write.ts`)
 * is now the only gate on send_email and attendee-bearing calendar writes -
 * the model no longer asks a separate natural-language question first - this
 * prompt has to carry the specifics on its own.
 *
 * Returns undefined for an action this can't describe (an unrecognized
 * action, or missing required fields), so the caller falls back to the
 * request's own prompt.
 */
function describeGoogleWorkspaceWrite(
  input: Record<string, unknown>
): string | undefined {
  const action = asString(input.action);
  switch (action) {
    case "send_email": {
      const to = asStringArray(input.to);
      if (to.length === 0) return undefined;
      const subject = asString(input.subject);
      const body = asString(input.body);
      const head = subject
        ? `send to ${to.join(", ")}, subject "${subject}"`
        : `send to ${to.join(", ")}`;
      return body ? `${head}: ${truncate(body, BODY_PREVIEW_MAX)}` : `${head}?`;
    }
    case "create_calendar_event":
    case "update_calendar_event": {
      const verb = action === "create_calendar_event" ? "create" : "update";
      const summary = asString(input.summary);
      const eventLabel = summary ? `"${summary}"` : "this event";
      const when = formatEventTime(input.start, input.end);
      const attendees = asStringArray(input.attendees);
      const pieces = [`${verb} ${eventLabel}`];
      if (when) pieces.push(when);
      if (attendees.length > 0) pieces.push(`inviting ${attendees.join(", ")}`);
      return `${pieces.join(", ")}?`;
    }
    case "delete_calendar_event":
      // The delete call only carries an eventId (see calendarEventDeleteSchema
      // in agent/lib/google-workspace/calendar.ts), so this can't name the
      // event or its guests - agent/instructions.md tells the model to state
      // those plainly in chat before calling the tool.
      return "cancel this calendar event? it may notify existing attendees.";
    default:
      return undefined;
  }
}

/**
 * Renders a human-in-the-loop input request as plain iMessage text.
 *
 * eve's default Chat SDK renderer is unusable over Linq. An options request
 * becomes a Card of Buttons, but the Linq adapter only emits `text` and `media`
 * parts, so nothing renders. So we render every request as plain text,
 * following the format rules in `agent/instructions.md`: no markdown, and a
 * numbered list ("1 ", "2 ", no period) only when genuinely offering a short
 * set of options to pick from.
 *
 * A follow-up message whose text matches an option's id, label, or numeric
 * index resolves the pending request automatically (eve's built-in HITL
 * resume contract - see `node_modules/eve/docs/tools/human-in-the-loop.md`),
 * so no custom resume wiring is needed here: this only controls what the
 * user sees while deciding what to type back.
 */
export function renderInputRequest(request: InputRequest): string {
  const options = request.options ?? [];
  let prompt = request.prompt.trim();
  if (
    request.kind === "tool-approval" &&
    request.action.toolName === GOOGLE_WORKSPACE_WRITE_TOOL
  ) {
    const described = describeGoogleWorkspaceWrite(request.action.input);
    if (described) prompt = described;
  }
  if (options.length === 0) return prompt;
  return [
    prompt,
    "",
    ...options.map((option, index) => `${String(index + 1)} ${option.label}`),
  ].join("\n");
}
