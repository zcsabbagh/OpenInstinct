import { defineTool } from "eve/tools";
import { scopeFromPrincipal } from "@/lib/access-scope";
import {
  createManagerSetupUrl,
  managerSetupRequestSchema,
} from "@/lib/manager";
import { mintVaultLinkToken } from "@/lib/manager/server/vault-link";
import { env } from "@/lib/env";

export default defineTool({
  description:
    "Create a safe link for adding one supported secret to the self-hosted vault. Supported kinds are login (username/email and password), payment (card details), address (one complete address), and phone (one phone number). The only safe prefill inputs are kind, label, and account; never invent or request other vault fields. Use ordinary non-secret contact details directly when the user supplied them in chat. The link only works for the person it was sent to, adds exactly the one item requested, and expires 15 minutes after it is created - if the user says it stopped working, call this again for a fresh one.",
  inputSchema: managerSetupRequestSchema,
  async execute(request, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const scope = scopeFromPrincipal(caller);
    const token = await mintVaultLinkToken(scope, request);

    return {
      message:
        "Text this link to the user and tell them it expires in 15 minutes. Do not send the secret in chat.",
      url: createManagerSetupUrl(env.BETTER_AUTH_URL, token),
    };
  },
});
