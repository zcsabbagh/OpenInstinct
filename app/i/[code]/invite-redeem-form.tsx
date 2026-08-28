"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeAuthPhoneNumber } from "@/lib/auth/phone-number";

export function InviteRedeemForm({ code }: { readonly code: string }) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const normalized = normalizeAuthPhoneNumber(phone);
    if (!normalized) {
      setError("Enter a valid phone number.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/invite/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, phone: normalized }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not claim this invite.");
      }
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not claim this invite."
      );
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="type-supporting-body mt-6 text-muted-foreground">
        You&rsquo;re on the list. Text Mouse from that number to get started.
      </p>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone number</Label>
        <Input
          autoComplete="tel"
          id="phone"
          onChange={(event) => setPhone(event.target.value.trim())}
          placeholder="(202) 555-0123"
          required
          type="tel"
          value={phone}
        />
      </div>
      {error ? (
        <p className="type-supporting-body text-destructive">{error}</p>
      ) : null}
      <Button className="w-full" disabled={loading} type="submit">
        {loading ? "Claiming…" : "Claim invite"}
      </Button>
    </form>
  );
}
