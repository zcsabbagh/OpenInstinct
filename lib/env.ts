import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { databaseUrlSchema } from "../db/env/utils";

const requiredValue = z
  .string()
  .refine((value) => value.trim().length > 0, "Required");

const secretEncryptionKeySchema = requiredValue.refine(
  (value) => Buffer.from(value, "base64").length === 32,
  "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
);

const optionalValue = z.string().optional();

export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: requiredValue,
    BETTER_AUTH_URL: requiredValue.refine(
      (value) => URL.canParse(value),
      "BETTER_AUTH_URL must be an absolute URL"
    ),
    DATABASE_URL: databaseUrlSchema,
    KERNEL_API_KEY: requiredValue,
    SECRET_ENCRYPTION_KEY: secretEncryptionKeySchema,

    GOOGLE_CONNECTOR_UID: optionalValue,
    ANTHROPIC_API_KEY: optionalValue,
    EXA_API_KEY: optionalValue,
    ELEVEN_API_KEY: optionalValue,
    MODEL_SMOKE_SECRET: optionalValue,
    LINQ_API_KEY: optionalValue,
    // The Linq line users text. Used to deep-link back into the iMessage
    // thread after they finish on a page we sent them to. Optional: without
    // it the button opens Messages with no recipient.
    LINQ_PHONE_NUMBER: optionalValue,
    LINQ_WEBHOOK_SECRET: optionalValue,
    // iCloud share link for the "Tell Mouse" Apple Shortcut (Record Audio ->
    // Send Message). Can only be produced by the Shortcuts app signing a
    // shortcut on a real device, so it can't be generated here - build the
    // shortcut once, then Shortcuts app > (...) on it > Share > Copy iCloud
    // Link. Optional: without it, send_shortcut_setup falls back to texting
    // manual build steps instead of a link.
    MOUSE_SHORTCUT_URL: optionalValue,
    // Front-door invite gate. Unset or anything other than "true" leaves the
    // gate open (fail-open) so the owner is never locked out.
    INVITE_GATE_ENABLED: optionalValue,
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("production"),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});

export const inviteGateEnabled = env.INVITE_GATE_ENABLED === "true";

const authHostname = new URL(env.BETTER_AUTH_URL).hostname;

export const localPhoneAuthBypassEnabled =
  env.NODE_ENV === "development" &&
  env.VERCEL_ENV === undefined &&
  (authHostname === "localhost" ||
    authHostname === "127.0.0.1" ||
    authHostname === "[::1]");
