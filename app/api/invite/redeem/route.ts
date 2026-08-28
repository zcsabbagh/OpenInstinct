import { isAllowedMutationOrigin } from "@/lib/manager";
import { normalizeAuthPhoneNumber } from "@/lib/auth/phone-number";
import { isInviteCode, redeemInvite } from "@/lib/invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public, unauthenticated: the invitee has no account yet. It only ever marks a
// single invite row redeemed with a normalized phone handle, which the Linq gate
// then recognizes. No outbound messaging happens here.
export async function POST(request: Request) {
  if (
    !isAllowedMutationOrigin({
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      requestUrl: request.url,
    })
  ) {
    return Response.json(
      { error: "Cross-origin request blocked." },
      {
        status: 403,
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { code, phone } =
    typeof body === "object" && body !== null
      ? (body as { code?: unknown; phone?: unknown })
      : {};
  if (typeof code !== "string" || !isInviteCode(code)) {
    return Response.json({ error: "Invalid invite code." }, { status: 400 });
  }
  const handle =
    typeof phone === "string" ? normalizeAuthPhoneNumber(phone) : undefined;
  if (!handle) {
    return Response.json(
      { error: "Enter a valid phone number." },
      {
        status: 400,
      }
    );
  }

  const result = await redeemInvite(code, handle);
  if (result === "not-found") {
    return Response.json(
      { error: "This invite link isn't valid." },
      {
        status: 404,
      }
    );
  }
  if (result === "already-redeemed") {
    return Response.json(
      { error: "This invite has already been used." },
      { status: 409 }
    );
  }
  return Response.json(
    { status: "redeemed" },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
