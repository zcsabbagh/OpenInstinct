import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  isSingleEmoji,
  resolveInboundLinqMessageId,
  sendLinqReaction,
} from "@/lib/linq-reactions";

export default defineTool({
  description:
    "React to the user's own message with an iMessage tapback (the emoji reaction that attaches to their bubble), instead of sending a reply. Reacts to the exact message that started this turn - never pass or guess a message id. Always available - use it whenever the user directly asks you to react to their message, and on your own initiative to acknowledge a completed, unambiguous action where a whole reply would be noise ('scheduled it', 'bought it', 'done') - a plain checkmark works well for that (✅). Never use this in place of a reply that carries information the user needs to read, such as a price, a time, a confirmation number, or anything else they need to see in text. You may still send a normal reply in the same turn if there is something worth saying; reacting does not replace that when there is.",
  inputSchema: z.object({
    reaction: z
      .string()
      .describe(
        "A single emoji, e.g. '✅'. Pick whichever one emoji best fits what just happened - not limited to a fixed set."
      ),
  }),
  async execute({ reaction }, ctx) {
    if (!isSingleEmoji(reaction)) {
      throw new Error(
        `"${reaction}" is not a single emoji. Pass exactly one emoji character, e.g. "✅".`
      );
    }
    const messageId = resolveInboundLinqMessageId(ctx);
    if (!messageId) {
      throw new Error(
        "No inbound message to react to in this turn (it did not start from a Linq message)."
      );
    }
    await sendLinqReaction(messageId, reaction);
    return { reacted: true, reaction };
  },
});
