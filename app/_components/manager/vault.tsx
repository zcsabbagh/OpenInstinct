"use client";

import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { BackToIMessage } from "@/app/_components/back-to-imessage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  ManagerMutation,
  ManagerSetupRequest,
  ManagerSnapshot,
} from "@/lib/manager";
import { AddressForm } from "./address-form";
import { LoginForm } from "./login-form";
import { PaymentCardForm } from "./payment-card-form";
import { PhoneForm } from "./phone-form";
import { useManager } from "./use-manager";

const categories = [
  {
    addLabel: "Add login",
    kind: "login",
    title: "Logins",
  },
  {
    addLabel: "Add card",
    kind: "payment",
    title: "Cards",
  },
  {
    addLabel: "Add address",
    kind: "address",
    title: "Addresses",
  },
  {
    addLabel: "Add phone",
    kind: "phone",
    title: "Phones",
  },
] as const;

export function VaultManager({
  initialSetup,
  returnPhoneNumber,
}: {
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly returnPhoneNumber?: string;
}) {
  const { busy, error, mutate, snapshot } = useManager();
  // Only when Mouse sent them here for a specific item: a save then completes
  // the errand it asked for, and the next thing they want is the thread.
  const [savedForSetup, setSavedForSetup] = useState(false);
  const submit = async (mutation: ManagerMutation) => {
    const saved = await mutate(mutation);
    if (saved && initialSetup) setSavedForSetup(true);
    return saved;
  };
  const legacyItems =
    snapshot?.vaultItems.filter(
      (item) => item.kind === "identity" || item.kind === "token"
    ) ?? [];

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <h1 className="sr-only">Vault</h1>

      {savedForSetup ? (
        <section className="space-y-3 rounded-lg border border-border/60 bg-muted/40 px-4 py-4">
          <div className="space-y-1">
            <h2 className="type-section-title">Saved</h2>
            <p className="type-body text-muted-foreground">
              Mouse can use it now, and never sees the value. Head back to the
              thread and it will keep going.
            </p>
          </div>
          <BackToIMessage phoneNumber={returnPhoneNumber} />
        </section>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <KeyRoundIcon />
          <AlertTitle>Vault unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {categories.map((category) => (
        <VaultCategory
          busy={busy}
          initialSetup={
            initialSetup?.kind === category.kind ? initialSetup : undefined
          }
          items={
            snapshot?.vaultItems.filter(
              (item) => item.kind === category.kind
            ) ?? []
          }
          key={category.kind}
          onDelete={mutate}
          onSubmit={submit}
          {...category}
        />
      ))}

      {legacyItems.length > 0 ? (
        <section aria-labelledby="other-vault-heading" className="space-y-3">
          <h2
            className="type-caption text-muted-foreground uppercase"
            id="other-vault-heading"
          >
            Other
          </h2>
          <div className="divide-y divide-border/50 border-y border-border/50">
            {legacyItems.map((item) => (
              <VaultItemRow
                busy={busy}
                item={item}
                key={item.id}
                onDelete={mutate}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function VaultCategory({
  addLabel,
  busy,
  initialSetup,
  items,
  kind,
  onDelete,
  onSubmit,
  title,
}: {
  readonly addLabel: string;
  readonly busy: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly items: ManagerSnapshot["vaultItems"];
  readonly kind: "address" | "login" | "payment" | "phone";
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
  readonly title: string;
}) {
  const headingId = `vault-${kind}-heading`;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2
        className="type-caption text-muted-foreground uppercase"
        id={headingId}
      >
        {title}
      </h2>
      {items.length > 0 ? (
        <div className="divide-y divide-border/50 border-y border-border/50">
          {items.map((item) => (
            <VaultItemRow
              busy={busy}
              item={item}
              key={item.id}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
      <VaultDialog
        addLabel={addLabel}
        busy={busy}
        initialSetup={initialSetup}
        kind={kind}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function VaultItemRow({
  busy,
  item,
  onDelete,
}: {
  readonly busy: boolean;
  readonly item: ManagerSnapshot["vaultItems"][number];
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate type-label">{item.label}</p>
        {item.account ? (
          <p className="type-supporting-body truncate text-muted-foreground">
            {item.account}
          </p>
        ) : null}
      </div>
      <Button
        aria-label={`Remove ${item.label}`}
        disabled={busy}
        onClick={() => void onDelete({ action: "vault.delete", id: item.id })}
        size="icon-sm"
        type="button"
        variant="quiet"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function VaultDialog({
  addLabel,
  busy,
  initialSetup,
  kind,
  onSubmit,
}: {
  readonly addLabel: string;
  readonly busy: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly kind: "address" | "login" | "payment" | "phone";
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(Boolean(initialSetup));
  const initialLabel = initialSetup?.label ?? "";
  const initialAccount = initialSetup?.account ?? "";

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            className="h-14 w-full justify-start border-dashed text-muted-foreground"
            type="button"
            variant="outline"
          />
        }
      >
        <PlusIcon />
        {addLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{addLabel}</DialogTitle>
          <DialogDescription>
            This value is stored locally and is never returned after saving.
          </DialogDescription>
        </DialogHeader>
        {kind === "payment" ? (
          <PaymentCardForm
            busy={busy}
            initialLabel={initialLabel}
            onSaved={() => setOpen(false)}
            onSubmit={onSubmit}
          />
        ) : null}
        {kind === "address" ? (
          <AddressForm
            busy={busy}
            initialLabel={initialLabel}
            onSaved={() => setOpen(false)}
            onSubmit={onSubmit}
          />
        ) : null}
        {kind === "phone" ? (
          <PhoneForm
            busy={busy}
            initialLabel={initialLabel}
            onSaved={() => setOpen(false)}
            onSubmit={onSubmit}
          />
        ) : null}
        {kind === "login" ? (
          <LoginForm
            busy={busy}
            initialAccount={initialAccount}
            initialLabel={initialLabel}
            onSaved={() => setOpen(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
