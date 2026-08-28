"use client";

import { KeyRoundIcon, MailIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ManagerSnapshot } from "@/lib/manager";
import { useManager } from "./use-manager";

export function WorkspaceManager({
  googleNotice,
}: {
  readonly googleNotice?: "unavailable";
}) {
  const { error, snapshot } = useManager();

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <h1 className="sr-only">Workspace</h1>

      {error ? (
        <Alert variant="destructive">
          <KeyRoundIcon />
          <AlertTitle>Workspace unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {googleNotice === "unavailable" ? (
        <Alert>
          <MailIcon />
          <AlertTitle>Google Workspace unavailable</AlertTitle>
          <AlertDescription>
            This deployment does not have a working Google OAuth connector yet.
          </AlertDescription>
        </Alert>
      ) : null}

      <GoogleWorkspaceSection connection={snapshot?.googleWorkspace} />
    </main>
  );
}

function GoogleWorkspaceSection({
  connection,
}: {
  readonly connection?: ManagerSnapshot["googleWorkspace"];
}) {
  const state = connection?.state;
  const connected = state === "connected";

  return (
    <section aria-labelledby="connections-heading" className="space-y-3">
      <h2 className="type-section-title" id="connections-heading">
        Connections
      </h2>
      <Card>
        <CardHeader>
          <div className="flex size-9 items-center justify-center rounded-md border border-border bg-background">
            <GoogleGlyph className="size-5" />
          </div>
          <CardTitle>Google Workspace</CardTitle>
          <CardDescription>
            {connected
              ? (connection?.accountLabel ??
                "Gmail, Calendar, and Contacts connected.")
              : state === "unavailable"
                ? "Attach a Vercel Connect Google OAuth connector to enable this."
                : "Gmail, Calendar, and Contacts through your Google account."}
          </CardDescription>
          <CardAction>
            <GoogleWorkspaceAction state={state} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {connected ? (
            <Badge variant="success">Connected</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
          <Badge variant="ghost">Gmail</Badge>
          <Badge variant="ghost">Calendar</Badge>
          <Badge variant="ghost">Contacts</Badge>
        </CardContent>
      </Card>
    </section>
  );
}

function GoogleWorkspaceAction({
  state,
}: {
  readonly state?: ManagerSnapshot["googleWorkspace"]["state"];
}) {
  if (!state) {
    return <span className="type-caption text-muted-foreground">Loading…</span>;
  }
  if (state === "unavailable") {
    return (
      <span className="type-caption text-muted-foreground">Setup required</span>
    );
  }

  const action = state === "connected" ? "disconnect" : "connect";
  return (
    <form action="/api/connectors/google" method="post">
      <input name="action" type="hidden" value={action} />
      <Button size="sm" type="submit" variant="outline">
        {state === "connected" ? "Disconnect" : "Connect"}
      </Button>
    </form>
  );
}

function GoogleGlyph({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M23.06 12.25c0-.86-.07-1.5-.22-2.16H12.24v3.92h6.2c-.13 1.02-.8 2.56-2.29 3.6l-.02.14 3.32 2.57.23.02c2.12-1.95 3.34-4.82 3.34-8.22"
        fill="#4285F4"
      />
      <path
        d="M12.24 24c3.02 0 5.56-1 7.41-2.72l-3.53-2.73c-.95.66-2.22 1.12-3.88 1.12-2.96 0-5.48-1.95-6.38-4.65l-.13.01-3.45 2.67-.05.13C3.72 21.32 7.7 24 12.24 24"
        fill="#34A853"
      />
      <path
        d="M5.86 15.02c-.24-.7-.37-1.45-.37-2.22 0-.77.13-1.52.36-2.22l-.01-.15L2.3 7.72l-.12.06A11.98 11.98 0 0 0 .9 12.8c0 1.93.46 3.76 1.28 5.38z"
        fill="#FBBC05"
      />
      <path
        d="M12.24 5.93c2.1 0 3.51.9 4.32 1.66l3.15-3.06C17.79 1.6 15.26.6 12.24.6 7.7.6 3.72 3.28 1.9 7.42l3.95 3.06c.91-2.7 3.43-4.55 6.39-4.55"
        fill="#EB4335"
      />
    </svg>
  );
}
