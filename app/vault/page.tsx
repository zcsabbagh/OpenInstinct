import { headers } from "next/headers";
import { ManagerShell } from "@/app/_components/manager-shell";
import { VaultManager } from "@/app/_components/manager/vault";
import type { Metadata } from "next";
import { getAuthSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { managerSetupRequestSchema } from "@/lib/manager";

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

  // proxy.ts lets this page through without a session so link-preview crawlers
  // can read its Open Graph tags. A real person without a session would
  // otherwise get the vault shell and a failed /api/manager fetch, so send them
  // to sign in and back.
  if (!(await getAuthSession(await headers()))) {
    return <SignedOutNotice query={query} />;
  }

  const requestedSetup = managerSetupRequestSchema.safeParse({
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
          requestedSetup.success && requestedSetup.data.target === "vault"
            ? requestedSetup.data
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
