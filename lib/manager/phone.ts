import { z } from "zod";

/**
 * A short list of common calling codes for the vault phone form's country
 * picker. It is intentionally not exhaustive - the national-number field
 * also accepts a full "+<code><number>" value pasted in directly, so an
 * unlisted country is never a dead end.
 */
export const COMMON_CALLING_CODES = [
  { callingCode: "+1", label: "United States / Canada" },
  { callingCode: "+44", label: "United Kingdom" },
  { callingCode: "+61", label: "Australia" },
  { callingCode: "+64", label: "New Zealand" },
  { callingCode: "+91", label: "India" },
  { callingCode: "+81", label: "Japan" },
  { callingCode: "+82", label: "South Korea" },
  { callingCode: "+86", label: "China" },
  { callingCode: "+65", label: "Singapore" },
  { callingCode: "+852", label: "Hong Kong" },
  { callingCode: "+49", label: "Germany" },
  { callingCode: "+33", label: "France" },
  { callingCode: "+34", label: "Spain" },
  { callingCode: "+39", label: "Italy" },
  { callingCode: "+31", label: "Netherlands" },
  { callingCode: "+32", label: "Belgium" },
  { callingCode: "+41", label: "Switzerland" },
  { callingCode: "+43", label: "Austria" },
  { callingCode: "+46", label: "Sweden" },
  { callingCode: "+47", label: "Norway" },
  { callingCode: "+45", label: "Denmark" },
  { callingCode: "+358", label: "Finland" },
  { callingCode: "+351", label: "Portugal" },
  { callingCode: "+353", label: "Ireland" },
  { callingCode: "+30", label: "Greece" },
  { callingCode: "+48", label: "Poland" },
  { callingCode: "+90", label: "Turkey" },
  { callingCode: "+972", label: "Israel" },
  { callingCode: "+971", label: "United Arab Emirates" },
  { callingCode: "+966", label: "Saudi Arabia" },
  { callingCode: "+27", label: "South Africa" },
  { callingCode: "+234", label: "Nigeria" },
  { callingCode: "+254", label: "Kenya" },
  { callingCode: "+20", label: "Egypt" },
  { callingCode: "+52", label: "Mexico" },
  { callingCode: "+55", label: "Brazil" },
  { callingCode: "+54", label: "Argentina" },
  { callingCode: "+56", label: "Chile" },
  { callingCode: "+57", label: "Colombia" },
  { callingCode: "+62", label: "Indonesia" },
  { callingCode: "+63", label: "Philippines" },
  { callingCode: "+66", label: "Thailand" },
  { callingCode: "+84", label: "Vietnam" },
  { callingCode: "+92", label: "Pakistan" },
  { callingCode: "+880", label: "Bangladesh" },
] as const;

// Loose E.164 shape: "+" then 7-15 digits total. This intentionally does not
// validate per-country length or area-code rules so non-US numbers are never
// rejected by an assumption tuned for US formatting.
export const phoneSecretSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/u, "Enter a valid phone number with country code.");

export function composePhoneNumber(
  callingCode: string,
  nationalNumber: string
) {
  const trimmed = nationalNumber.trim();
  if (trimmed.startsWith("+")) return trimmed.replaceAll(/[^\d+]/gu, "");
  const digits = trimmed.replaceAll(/\D/gu, "");
  return `${callingCode}${digits}`;
}
