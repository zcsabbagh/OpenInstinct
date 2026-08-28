import { defineTool } from "eve/tools";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  buildConfiguredShortcutMessage,
  buildManualShortcutMessage,
} from "@/lib/shortcut-setup";

export default defineTool({
  description:
    'Send the user the setup for "Tell Mouse", an Apple Shortcut that records a voice note and sends it straight to this thread with one press (Action Button, Back Tap, or a Home Screen icon) instead of opening Messages by hand. Call this when the user asks for a faster or hands-free way to reach you, mentions the Action Button, or is texting from the car. Returns ready-to-send plain text: an iCloud install link when one is configured, otherwise manual build steps for the two actions. Relay the returned text to the user close to verbatim - it already follows the plain-text formatting rules.',
  inputSchema: z.object({}),
  execute(_input) {
    const shortcutUrl = env.MOUSE_SHORTCUT_URL;
    if (shortcutUrl) {
      return {
        configured: true as const,
        message: buildConfiguredShortcutMessage(shortcutUrl),
      };
    }
    return {
      configured: false as const,
      message: buildManualShortcutMessage(env.LINQ_PHONE_NUMBER),
    };
  },
});
