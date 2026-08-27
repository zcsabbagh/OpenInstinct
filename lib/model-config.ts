import { readGatewayModel } from "@/db/services/settings";
import type { AccessScope } from "./access-scope";
import { DEFAULT_MODEL_ID } from "./models";

export const DIRECT_HAIKU_CONTEXT_WINDOW_TOKENS = 200_000;

export function createDirectHaikuSelection<TModel>(model: TModel) {
  return {
    model,
    modelContextWindowTokens: DIRECT_HAIKU_CONTEXT_WINDOW_TOKENS,
  } as const;
}

export async function getModelSettings(scope: AccessScope) {
  return {
    modelId: (await readGatewayModel(scope)) ?? DEFAULT_MODEL_ID,
  };
}
