import { InviteRedeemForm } from "@/app/i/[code]/invite-redeem-form";
import { Logo } from "@/components/ui/logo";
import { getInvite, isInviteCode } from "@/lib/invites";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}) {
  const { code } = await params;
  const invite = isInviteCode(code) ? await getInvite(code) : undefined;

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-sm">
        <Logo className="size-9" />
        {!invite ? (
          <Message
            body="Ask whoever sent it for a fresh link."
            title="This invite link isn't valid"
          />
        ) : invite.redeemedAt ? (
          <Message
            body="Each invite works once. Ask for a new one if you still need in."
            title="This invite has already been used"
          />
        ) : (
          <>
            <h1 className="type-page-title mt-6">
              You&rsquo;re invited to Mouse
            </h1>
            <p className="type-supporting-body mt-2 text-muted-foreground">
              Enter your phone number to claim this invite. Then text Mouse from
              that number and you&rsquo;re in.
            </p>
            <InviteRedeemForm code={invite.code} />
          </>
        )}
      </section>
    </main>
  );
}

function Message({
  body,
  title,
}: {
  readonly body: string;
  readonly title: string;
}) {
  return (
    <>
      <h1 className="type-page-title mt-6">{title}</h1>
      <p className="type-supporting-body mt-2 text-muted-foreground">{body}</p>
    </>
  );
}
