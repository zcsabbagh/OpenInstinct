import { headers } from "next/headers";
import { ManagerShell } from "@/app/_components/manager-shell";
import { VaultLinkForm } from "@/app/_components/manager/vault-link-form";
import { VaultManager } from "@/app/_components/manager/vault";
import type { Metadata } from "next";
import { Logo } from "@/components/ui/logo";
import { getAuthSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { managerSetupRequestSchema } from "@/lib/manager";
import { peekVaultLinkToken } from "@/lib/manager/server/vault-link";

export const metadata: Metadata = {
  description:
    "Enter it on this page, never in the chat. Mouse fills it into the browser without ever seeing the value.",
  openGraph: {
    description:
      "Enter it on this page, never in the chat. Mouse fills it into the browser without ever seeing the value.",
    title: "Add details to your Mouse vault",
    type: "website",
  },
  title: "Add details to your Mouse vault",
};

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  const query = await searchParams;
  const token = firstQueryValue(query.token);

  // Read-only lookup: never consumes the token. Safe to run on every render,
  // including the automated link-preview fetch Apple's iMessage client
  // makes for the og: tags the instant the link is delivered - see
  // proxy.ts's allowlist comment and app/vault/opengraph-image.tsx. The
  // token is only ever consumed by app/api/vault-link/route.ts, at the
  // moment of a successful write.
  const tokenPayload = token ? await peekVaultLinkToken(token) : undefined;

  const session = await getAuthSession(await headers());

  if (!session) {
    // proxy.ts lets this page through without a session so link-preview
    // crawlers can read its Open Graph tags. A signed-in-required page would
    // otherwise redirect the crawler to /sign-in and produce a blank card.
    if (!token) return <SignedOutNotice query={query} />;
    if (!tokenPayload) return <ExpiredLinkNotice />;

    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-6 py-16">
        <Logo className="size-8" />
        <VaultLinkForm
          account={tokenPayload.account}
          kind={tokenPayload.kind}
          label={tokenPayload.label}
          returnPhoneNumber={env.LINQ_PHONE_NUMBER}
          token={token}
        />
      </main>
    );
  }

  // A signed-in visitor always gets the full portal - list, delete, and all -
  // never the narrow token-only form above. A live token in the URL only
  // prefills which item to add; it is never consumed here, so it stays good
  // for the token-only path above (or a retry) either way.
  const legacySetup = managerSetupRequestSchema.safeParse({
    account: firstQueryValue(query.account),
    kind: firstQueryValue(query.kind),
    label: firstQueryValue(query.label),
    target: firstQueryValue(query.setup),
  });

  return (
    <ManagerShell active="vault">
      <VaultManager
        returnPhoneNumber={env.LINQ_PHONE_NUMBER}
        initialSetup={
          tokenPayload
            ? {
                account: tokenPayload.account,
                kind: tokenPayload.kind,
                label: tokenPayload.label,
                target: "vault",
              }
            : legacySetup.success && legacySetup.data.target === "vault"
              ? legacySetup.data
              : undefined
        }
      />
    </ManagerShell>
  );
}

function firstQueryValue(value: string | readonly string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SignedOutNotice({
  query,
}: {
  readonly query: Record<string, string | readonly string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const first = firstQueryValue(value);
    if (first !== undefined) params.set(key, first);
  }
  const search = params.toString();
  const callbackUrl = search ? `/vault?${search}` : "/vault";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Sign in to your vault</h1>
        <p className="text-muted-foreground">
          Verify the phone number you text Mouse from, then you can add the
          details it asked for. Mouse never sees the value you enter.
        </p>
        <a
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          Sign in
        </a>
      </div>
    </main>
  );
}

function ExpiredLinkNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">This link has expired</h1>
        <p className="text-muted-foreground">
          For your security, vault links only work for a few minutes after Mouse
          sends them. Text Mouse and ask it to send a new one.
        </p>
      </div>
    </main>
  );
}
