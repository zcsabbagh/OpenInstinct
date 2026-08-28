import { ManagerShell } from "@/app/_components/manager-shell";
import { VaultManager } from "@/app/_components/manager/vault";
import type { Metadata } from "next";
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
  const requestedSetup = managerSetupRequestSchema.safeParse({
    account: firstQueryValue(query.account),
    kind: firstQueryValue(query.kind),
    label: firstQueryValue(query.label),
    target: firstQueryValue(query.setup),
  });

  return (
    <ManagerShell active="vault">
      <VaultManager
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
