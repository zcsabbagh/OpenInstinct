import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { env } from "@/lib/env";

/**
 * Direct-provider model resolution.
 *
 * eve accepts either a Vercel AI Gateway model id string (routed through the
 * Gateway) or a provider-authored `LanguageModel` (called directly with our own
 * key). We use the latter for everything so no paid AI Gateway tier is required.
 *
 * The workspace model selector stores an AI Gateway id (e.g.
 * `anthropic/claude-opus-4.8`). `resolveModelSelection` turns that into a direct
 * `LanguageModel` for a provider we have a key for, and falls back to the
 * default model for anything else — never to the Gateway, which a free Gateway
 * tier rejects.
 */

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5";

// Context window per Gateway id. eve can auto-resolve this from the Gateway
// catalog when omitted, but the catalog has no entry for a direct native id
// (e.g. `claude-haiku-4-5`), so we set it here. Add a row when you enable a
// model with a larger window than the 200K default.
const CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  "anthropic/claude-haiku-4.5": 200_000,
  "anthropic/claude-sonnet-4.5": 1_000_000,
  "anthropic/claude-sonnet-4.6": 1_000_000,
  "anthropic/claude-sonnet-5": 1_000_000,
  "anthropic/claude-opus-4.6": 1_000_000,
  "anthropic/claude-opus-4.8": 1_000_000,
  "anthropic/claude-opus-5": 1_000_000,
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

export interface DirectModelSelection {
  readonly model: LanguageModel;
  readonly modelContextWindowTokens: number;
}

function directSelection(gatewayId: string): DirectModelSelection | null {
  if (gatewayId.startsWith("anthropic/") && env.ANTHROPIC_API_KEY) {
    const nativeId = gatewayId.slice("anthropic/".length).replace(/\./gu, "-");
    return {
      model: anthropic(nativeId),
      modelContextWindowTokens:
        CONTEXT_WINDOW_TOKENS[gatewayId] ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    };
  }

  // To add another provider: `pnpm add @ai-sdk/openai`, add its key to
  // lib/env.ts, then mirror the block above:
  //   if (gatewayId.startsWith("openai/") && env.OPENAI_API_KEY) { ... }

  return null;
}

export function resolveModelSelection(modelId: string): DirectModelSelection {
  const selected = directSelection(modelId);
  if (selected) return selected;

  if (modelId !== DEFAULT_MODEL_ID) {
    console.warn(
      `[models] no direct provider configured for "${modelId}" — using ${DEFAULT_MODEL_ID}`
    );
  }

  const fallback = directSelection(DEFAULT_MODEL_ID);
  if (!fallback) {
    throw new Error(
      "ANTHROPIC_API_KEY is required to serve the default model."
    );
  }
  return fallback;
}
