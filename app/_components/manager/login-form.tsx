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
import type { ManagerMutation } from "@/lib/manager";

const loginFormSchema = z.object({
  account: z.string().trim().max(200),
  name: z.string().trim().min(1, "Give this login a name."),
  password: z.string().min(1, "Enter the password."),
});

export function LoginForm({
  busy,
  initialAccount = "",
  initialLabel = "",
  onSaved,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly initialAccount?: string;
  readonly initialLabel?: string;
  readonly onSaved: () => void;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState({
    account: initialAccount,
    name: initialLabel,
    password: "",
  });
  const result = loginFormSchema.safeParse(form);
  const errors =
    attempted && !result.success ? result.error.flatten().fieldErrors : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!result.success) return;

    const saved = await onSubmit({
      action: "vault.create",
      input: {
        account: result.data.account,
        kind: "login",
        label: result.data.name,
        secret: result.data.password,
      },
    });
    if (saved) onSaved();
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <FieldGroup className="gap-3">
        <LoginField
          autoComplete="off"
          error={errors.name?.[0]}
          id="vault-login-name"
          label="Name"
          onChange={(name) => setForm((current) => ({ ...current, name }))}
          placeholder="GitHub"
          value={form.name}
        />
        <LoginField
          autoComplete="username"
          error={errors.account?.[0]}
          id="vault-login-account"
          label="Username or email"
          onChange={(account) =>
            setForm((current) => ({ ...current, account }))
          }
          placeholder="name@example.com"
          value={form.account}
        />
        <LoginField
          autoComplete="new-password"
          error={errors.password?.[0]}
          id="vault-login-password"
          label="Password"
          onChange={(password) =>
            setForm((current) => ({ ...current, password }))
          }
          type="password"
          value={form.password}
        />
      </FieldGroup>

      <div className="mt-5 flex justify-end">
        <Button disabled={busy} type="submit">
          Save login
        </Button>
      </div>
    </form>
  );
}

function LoginField({
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
