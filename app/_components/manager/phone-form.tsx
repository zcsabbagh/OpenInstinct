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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ManagerMutation } from "@/lib/manager";
import {
  COMMON_CALLING_CODES,
  composePhoneNumber,
  phoneSecretSchema,
} from "@/lib/manager/phone";

const phoneFormFieldSchema = z.object({
  callingCode: z.string().min(1, "Choose a country code."),
  nationalNumber: z.string().trim().min(1, "Enter the phone number."),
  nickname: z.string().trim().min(1, "Give this number a name."),
});

export function PhoneForm({
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
    callingCode: "+1",
    nationalNumber: "",
    nickname: initialLabel,
  });

  const fieldResult = phoneFormFieldSchema.safeParse(form);
  const secret = fieldResult.success
    ? composePhoneNumber(form.callingCode, form.nationalNumber)
    : undefined;
  const secretValid =
    secret !== undefined ? phoneSecretSchema.safeParse(secret).success : false;
  const canSubmit = fieldResult.success && secretValid;

  const errors = attempted
    ? {
        nationalNumber:
          (!fieldResult.success &&
            fieldResult.error.flatten().fieldErrors.nationalNumber?.[0]) ||
          (fieldResult.success && !secretValid
            ? "Enter a valid phone number with country code."
            : undefined),
        nickname: !fieldResult.success
          ? fieldResult.error.flatten().fieldErrors.nickname?.[0]
          : undefined,
      }
    : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!canSubmit || secret === undefined) return;

    const saved = await onSubmit({
      action: "vault.create",
      input: {
        account: "",
        kind: "phone",
        label: form.nickname.trim(),
        secret,
      },
    });
    if (saved) onSaved();
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <FieldGroup className="gap-3">
        <Field data-invalid={errors.nickname ? true : undefined}>
          <FieldLabel htmlFor="vault-phone-nickname">Name</FieldLabel>
          <Input
            aria-invalid={errors.nickname ? true : undefined}
            id="vault-phone-nickname"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                nickname: event.target.value,
              }))
            }
            placeholder="Mobile"
            value={form.nickname}
          />
          <FieldError
            errors={
              errors.nickname ? [{ message: errors.nickname }] : undefined
            }
          />
        </Field>

        <Field data-invalid={errors.nationalNumber ? true : undefined}>
          <FieldLabel htmlFor="vault-phone-number">Phone number</FieldLabel>
          <div className="flex gap-2">
            <Select
              onValueChange={(value) =>
                value &&
                setForm((current) => ({ ...current, callingCode: value }))
              }
              value={form.callingCode}
            >
              <SelectTrigger
                aria-label="Country calling code"
                className="w-24 shrink-0"
                id="vault-phone-calling-code"
              >
                <SelectValue>
                  {(value: string | null) => value ?? "Code"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMMON_CALLING_CODES.map((entry) => (
                  <SelectItem key={entry.callingCode} value={entry.callingCode}>
                    {entry.callingCode} {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-invalid={errors.nationalNumber ? true : undefined}
              autoComplete="tel-national"
              className="flex-1"
              id="vault-phone-number"
              inputMode="tel"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  nationalNumber: event.target.value,
                }))
              }
              placeholder="555 555 5555"
              type="tel"
              value={form.nationalNumber}
            />
          </div>
          <FieldError
            errors={
              errors.nationalNumber
                ? [{ message: errors.nationalNumber }]
                : undefined
            }
          />
        </Field>
      </FieldGroup>

      <div className="mt-5 flex justify-end">
        <Button disabled={busy} type="submit">
          Save phone
        </Button>
      </div>
    </form>
  );
}
