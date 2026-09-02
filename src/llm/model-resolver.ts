import { getModel } from "@earendil-works/pi-ai/compat";
import type { CustomModelDefinition } from "../config.js";

export type ResolvedPiModel = NonNullable<ReturnType<typeof getModel>>;

/**
 * Resolve a built-in pi model or an operator-defined alias.
 *
 * Aliases deliberately inherit only from a known model on the same provider.
 * The clone keeps pi's provider transport, context, tool, reasoning, and
 * compatibility metadata while replacing the wire model id. Arbitrary base
 * URLs, headers, and credentials never cross the control-plane boundary.
 */
export function resolvePiModel(
  provider: string,
  modelId: string,
  customModels: readonly CustomModelDefinition[] = [],
): ResolvedPiModel | undefined {
  const direct = getModelSafe(provider, modelId);
  if (direct) return direct;
  const definition = customModels.find((entry) => entry.provider === provider && entry.model === modelId);
  if (!definition) return undefined;
  const base = getModelSafe(provider, definition.baseModel);
  if (!base) return undefined;
  return {
    ...base,
    id: definition.model,
    name: `${definition.model} (compatible with ${definition.baseModel})`,
  } as ResolvedPiModel;
}

function getModelSafe(provider: string, modelId: string): ResolvedPiModel | undefined {
  try {
    return getModel(provider as never, modelId as never) ?? undefined;
  } catch {
    return undefined;
  }
}
