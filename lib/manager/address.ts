import { z } from "zod";

const addressSecretSchema = z.object({
  city: z.string().trim().min(1).max(120),
  country: z.string().trim().min(1).max(60),
  kind: z.literal("address"),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).default(""),
  postalCode: z.string().trim().min(1).max(20),
  region: z.string().trim().min(1).max(120),
  version: z.literal(1),
});

export type AddressSecret = z.infer<typeof addressSecretSchema>;

export const addressSecretStringSchema = z
  .string()
  .superRefine((value, context) => {
    try {
      const result = addressSecretSchema.safeParse(JSON.parse(value));
      if (!result.success) {
        context.addIssue({
          code: "custom",
          message: "Enter a complete address.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a complete address.",
      });
    }
  });

export function serializeAddress(input: z.input<typeof addressSecretSchema>) {
  return JSON.stringify(addressSecretSchema.parse(input));
}

/**
 * Parse a stored address secret. Structured JSON is the only shape this
 * feature has ever written, but tolerate a bare free-text string as a
 * defensive fallback in case an environment carried over a pre-structured
 * single-line address - it still resolves the composite "address" autofill
 * field even though the granular line1/city/region/postal fields stay empty.
 */
export function parseAddressSecret(value: string): AddressSecret {
  try {
    const parsed = addressSecretSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through to the legacy single-line fallback below.
  }
  return {
    city: "",
    country: "",
    kind: "address",
    line1: value,
    line2: "",
    postalCode: "",
    region: "",
    version: 1,
  };
}

export function formatAddressSingleLine(address: AddressSecret) {
  const cityLine = [address.city, address.region, address.postalCode]
    .filter((part) => part.trim().length > 0)
    .join(", ");
  return [address.line1, address.line2, cityLine, address.country]
    .filter((part) => part.trim().length > 0)
    .join(", ");
}
