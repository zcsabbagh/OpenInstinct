import { BackToIMessage } from "@/app/_components/back-to-imessage";
import { env } from "@/lib/env";

export default function GoogleConnectedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Google Workspace connected</h1>
        <p className="text-muted-foreground">
          You can close this page and return to your conversation with Mouse.
        </p>
        <BackToIMessage phoneNumber={env.LINQ_PHONE_NUMBER} />
      </div>
    </main>
  );
}
