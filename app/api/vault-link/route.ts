import { z } from "zod";
import {
  crossOriginMutationDenied,
  managerMutationSchema,
} from "@/lib/manager";
import { consumeVaultLinkToken } from "@/lib/manager/server/vault-link";
import { createTokenScopedVaultItem } from "@/lib/manager/server/store";

// Token-authorized counterpart to /api/manager/route.ts. Deliberately does
// not share that handler: a token here proves the caller holds a
// single-use capability for exactly one write (add one vault item, of one
// kind, to one workspace), not a Better Auth session. Keeping that on its
// own route with its own, narrower response shape means there is no code
// path where a token request can reach readManagerSnapshot, vault.delete,
// or model.select - those stay reachable only through requireRequestScope's
// session check in /api/manager.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const vaultLinkWriteRequestSchema = z.object({
  mutation: managerMutationSchema,
  token: z.string().trim().min(1).max(2_000),
});

export async function POST(request: Request) {
  if (crossOriginMutationDenied(request)) {
    return errorResponse("Cross-origin vault link writes are blocked.", 403);
  }

  const parsed = vaultLinkWriteRequestSchema.safeParse(
    await request.json().catch(() => undefined)
  );
  if (!parsed.success) return errorResponse("Invalid request.", 400);

  const { mutation, token } = parsed.data;
  if (mutation.action !== "vault.create") {
    return errorResponse("This link can only add one vault item.", 403);
  }

  // Consume the token only now, at the moment of a validated write attempt -
  // never on render (see app/vault/page.tsx, which only peeks) so a
  // cookieless link-preview fetch of the page can never burn it.
  const authorization = await consumeVaultLinkToken(token);
  if (!authorization) {
    return errorResponse(
      "This link has expired. Ask Mouse to send a new one.",
      410
    );
  }
  if (authorization.kind !== mutation.input.kind) {
    return errorResponse("This link cannot be used for that item.", 403);
  }

  await createTokenScopedVaultItem(
    { userId: authorization.userId, workspaceId: authorization.workspaceId },
    mutation.input
  );

  // Intentionally not the manager snapshot: this response must not hand a
  // token holder a list of everything else in the workspace's vault.
  return Response.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
