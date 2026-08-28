import { z } from "zod";

const apiErrorSchema = z.object({ error: z.string() });
const errorSchema = z.instanceof(Error);

/**
 * Extracts the `{ error }` message a manager API route sends on a non-ok
 * response, if the body has that shape. Shared by `use-manager.ts` (the
 * session-scoped `/api/manager` client) and `vault-link-form.tsx` (the
 * token-scoped `/api/vault-link` client) so the two independent write paths
 * don't each carry their own copy of the same tiny parse.
 */
export function apiErrorMessage(body: unknown): string | undefined {
  return apiErrorSchema.safeParse(body).data?.error;
}

/** Extracts a caught value's `.message` if it is an `Error`. */
export function caughtErrorMessage(caught: unknown): string | undefined {
  return errorSchema.safeParse(caught).data?.message;
}
