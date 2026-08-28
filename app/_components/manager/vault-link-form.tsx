"use client";

import { useState } from "react";
import { BackToIMessage } from "@/app/_components/back-to-imessage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ManagerMutation, VaultSetupKind } from "@/lib/manager";
import { AddressForm } from "./address-form";
import { apiErrorMessage, caughtErrorMessage } from "./api-error";
import { LoginForm } from "./login-form";
import { PaymentCardForm } from "./payment-card-form";
import { PhoneForm } from "./phone-form";

const kindCopy: Record<VaultSetupKind, string> = {
  address: "Add address",
  login: "Add login",
  payment: "Add card",
  phone: "Add phone",
};

/**
 * The only thing a vault link recipient sees: one add-form for the kind
 * Mouse asked for. No item list, no delete, no shell nav - a token proves
 * the holder may add exactly this one item, nothing else, so that is all
 * this page offers. Compare `VaultManager` (`./vault.tsx`), which renders
 * the full portal for a signed-in session.
 */
export function VaultLinkForm({
  account,
  kind,
  label,
  returnPhoneNumber,
  token,
}: {
  readonly account: string;
  readonly kind: VaultSetupKind;
  readonly label: string;
  readonly returnPhoneNumber?: string;
  readonly token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const submit = async (mutation: ManagerMutation) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/vault-link", {
        body: JSON.stringify({ mutation, token }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new Error(apiErrorMessage(body) ?? "That link no longer works.");
      }
      setSaved(true);
      return true;
    } catch (submitError) {
      setError(caughtErrorMessage(submitError) ?? "That link no longer works.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <section className="space-y-3">
        <h1 className="type-section-title">Saved</h1>
        <p className="type-body text-muted-foreground">
          Mouse can use it now, and never sees the value. Head back to the
          thread and it will keep going.
        </p>
        <BackToIMessage phoneNumber={returnPhoneNumber} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="type-section-title">{kindCopy[kind]}</h1>
      <p className="type-body text-muted-foreground">
        This value is stored locally and is never returned after saving.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {kind === "payment" ? (
        <PaymentCardForm
          busy={busy}
          initialLabel={label}
          onSaved={() => {}}
          onSubmit={submit}
        />
      ) : null}
      {kind === "address" ? (
        <AddressForm
          busy={busy}
          initialLabel={label}
          onSaved={() => {}}
          onSubmit={submit}
        />
      ) : null}
      {kind === "phone" ? (
        <PhoneForm
          busy={busy}
          initialLabel={label}
          onSaved={() => {}}
          onSubmit={submit}
        />
      ) : null}
      {kind === "login" ? (
        <LoginForm
          busy={busy}
          initialAccount={account}
          initialLabel={label}
          onSaved={() => {}}
          onSubmit={submit}
        />
      ) : null}
    </section>
  );
}
