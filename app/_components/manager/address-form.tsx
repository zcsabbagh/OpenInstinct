"use client";

import { type FormEvent, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { serializeAddress } from "@/lib/manager/address";
import type { ManagerMutation } from "@/lib/manager";

const addressFormSchema = z.object({
  city: z.string().trim().min(1, "Enter the city."),
  country: z.string().trim().min(1, "Enter the country."),
  line1: z.string().trim().min(1, "Enter the street address."),
  line2: z.string().trim(),
  nickname: z.string().trim().min(1, "Give this address a name."),
  postalCode: z.string().trim().min(1, "Enter the postal code."),
  region: z.string().trim().min(1, "Enter the state or region."),
});

export function AddressForm({
  busy,
  initialLabel = "",
  onSaved,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly initialLabel?: string;
  readonly onSaved: () => void;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState({
    city: "",
    country: "",
    line1: "",
    line2: "",
    nickname: initialLabel,
    postalCode: "",
    region: "",
  });
  const result = addressFormSchema.safeParse(form);
  const errors =
    attempted && !result.success ? result.error.flatten().fieldErrors : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!result.success) return;

    const saved = await onSubmit({
      action: "vault.create",
      input: {
        account: "",
        kind: "address",
        label: result.data.nickname,
        secret: serializeAddress({
          city: result.data.city,
          country: result.data.country,
          kind: "address",
          line1: result.data.line1,
          line2: result.data.line2,
          postalCode: result.data.postalCode,
          region: result.data.region,
          version: 1,
        }),
      },
    });
    if (saved) onSaved();
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <FieldGroup className="gap-3">
        <AddressField
          autoComplete="off"
          error={errors.nickname?.[0]}
          id="vault-address-nickname"
          label="Name"
          onChange={(nickname) =>
            setForm((current) => ({ ...current, nickname }))
          }
          placeholder="Home"
          value={form.nickname}
        />
        <AddressField
          autoComplete="address-line1"
          error={errors.line1?.[0]}
          id="vault-address-line1"
          label="Street address"
          onChange={(line1) => setForm((current) => ({ ...current, line1 }))}
          placeholder="1 Main St"
          value={form.line1}
        />
        <AddressField
          autoComplete="address-line2"
          error={errors.line2?.[0]}
          id="vault-address-line2"
          label="Apt, suite, etc. (optional)"
          onChange={(line2) => setForm((current) => ({ ...current, line2 }))}
          value={form.line2}
        />
        <div className="grid grid-cols-2 gap-3">
          <AddressField
            autoComplete="address-level2"
            error={errors.city?.[0]}
            id="vault-address-city"
            label="City"
            onChange={(city) => setForm((current) => ({ ...current, city }))}
            value={form.city}
          />
          <AddressField
            autoComplete="address-level1"
            error={errors.region?.[0]}
            id="vault-address-region"
            label="State / region"
            onChange={(region) =>
              setForm((current) => ({ ...current, region }))
            }
            value={form.region}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <AddressField
            autoComplete="postal-code"
            error={errors.postalCode?.[0]}
            id="vault-address-postal-code"
            label="Postal code"
            onChange={(postalCode) =>
              setForm((current) => ({ ...current, postalCode }))
            }
            value={form.postalCode}
          />
          <AddressField
            autoComplete="country-name"
            error={errors.country?.[0]}
            id="vault-address-country"
            label="Country"
            onChange={(country) =>
              setForm((current) => ({ ...current, country }))
            }
            placeholder="United States"
            value={form.country}
          />
        </div>
      </FieldGroup>

      <div className="mt-5 flex justify-end">
        <Button disabled={busy} type="submit">
          Save address
        </Button>
      </div>
    </form>
  );
}

function AddressField({
  error,
  id,
  label,
  onChange,
  ...inputProps
}: Omit<React.ComponentProps<typeof Input>, "onChange"> & {
  readonly error?: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...inputProps}
        aria-invalid={error ? true : undefined}
        id={id}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}
