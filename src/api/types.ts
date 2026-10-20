export interface MiniMaxReasoningDetail {
  text: string;
  id?: string;
  type?: string;
  format?: string;
  index?: number;
  [key: string]: unknown;
}

export interface MiniMaxToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  index?: number;
}

export type MiniMaxChatContent = string | readonly MiniMaxUserContentPart[];

export type MiniMaxUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface MiniMaxSystemMessage {
  role: "system";
  content: string;
  name?: string;
}

export interface MiniMaxUserMessage {
  role: "user";
  content: MiniMaxChatContent;
  name?: string;
}

export interface MiniMaxAssistantMessage {
  role: "assistant";
  content: string;
  name?: string;
  tool_calls?: MiniMaxToolCall[];
  reasoning_details?: MiniMaxReasoningDetail[];
}

export interface MiniMaxToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type MiniMaxMessage =
  | MiniMaxSystemMessage
  | MiniMaxUserMessage
  | MiniMaxAssistantMessage
  | MiniMaxToolMessage;

export interface MiniMaxToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export const MODEL_IDS = [
  "MiniMax-M3.1-Flash",
  "MiniMax-M3",
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2.1-highspeed",
  "MiniMax-M2",
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

/**
 * Thinking-depth levels accepted by MiniMax-M3.1-Flash.
 *
 * `MiniMax-M3.1-Flash` is the only model that exposes a tunable reasoning
 * depth: `output_config.effort` on the Anthropic-compatible endpoint and
 * `reasoning_effort` on the OpenAI-compatible one. `none` is rejected by the
 * API, and omitting the field lets the endpoint default to `max`.
 */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfo {
  id: ModelId;
  name: string;
  contextLength: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  apiModelId?: string;
  /**
   * Max tokens requested when the client does not ask for a specific budget.
   * Thinking tokens count towards `max_tokens`, so models that always think
   * need a bigger default budget than the shared one.
   */
  defaultMaxTokens?: number;
}

export const DEFAULT_MODEL_ID: ModelId = "MiniMax-M3";

const CTX_1M = 1_000_000;
const CTX_204K = 204_800;
const OUT_131K = 131_072;
const OUT_128K = 128_000;

export const SUPPORTED_MODELS: readonly ModelInfo[] = [
  {
    id: "MiniMax-M3.1-Flash",
    name: "MiniMax M3.1 Flash",
    contextLength: CTX_1M,
    maxInputTokens: 1_000_000,
    maxOutputTokens: OUT_131K,
    // M3.1 Flash always thinks (at `max` depth unless told otherwise), and
    // thinking tokens are billed against `max_tokens`. A bigger default budget
    // keeps the visible answer from being squeezed out by the reasoning pass.
    defaultMaxTokens: 32_768,
  },
  { id: "MiniMax-M3", name: "MiniMax M3", contextLength: CTX_1M, maxInputTokens: 1_000_000, maxOutputTokens: OUT_131K },
  { id: "MiniMax-M2.7", name: "MiniMax M2.7", contextLength: CTX_204K, maxInputTokens: 200_000, maxOutputTokens: OUT_131K },
  { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 (High-Speed)", contextLength: CTX_204K, maxInputTokens: 200_000, maxOutputTokens: OUT_131K },
  { id: "MiniMax-M2.5", name: "MiniMax M2.5", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K },
  { id: "MiniMax-M2.5-highspeed", name: "MiniMax M2.5 (High-Speed)", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K },
  { id: "MiniMax-M2.1", name: "MiniMax M2.1", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K },
  { id: "MiniMax-M2.1-highspeed", name: "MiniMax M2.1 (High-Speed)", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K },
  { id: "MiniMax-M2", name: "MiniMax M2", contextLength: CTX_204K, maxInputTokens: 192_000, maxOutputTokens: OUT_128K },
];

/**
 * Model ids MiniMax renamed when a preview model went generally available.
 *
 * `MiniMax-M3.1-Flash-Preview` became `MiniMax-M3.1-Flash` in October 2026.
 * The alias keeps `minimax.visibleModels` entries written against the preview
 * id working instead of silently dropping the model from the picker.
 */
export const LEGACY_MODEL_ALIASES: Readonly<Record<string, ModelId>> = {
  "MiniMax-M3.1-Flash-Preview": "MiniMax-M3.1-Flash",
};

/**
 * Map a possibly-legacy model id onto the current id. Unknown ids are
 * returned unchanged so callers can still report them as unsupported.
 */
export function resolveLegacyModelId(id: string): string {
  return LEGACY_MODEL_ALIASES[id] ?? id;
}

const MODEL_BY_ID: Readonly<Record<ModelId, ModelInfo>> = Object.fromEntries(
  SUPPORTED_MODELS.map((model) => [model.id, model]),
) as Record<ModelId, ModelInfo>;

export function resolveModelIdForApi(id: string): string {
  const resolved = resolveLegacyModelId(id);
  const info = getModelById(resolved);
  if (!info) {
    return resolved;
  }
  return info.apiModelId ?? info.id;
}

export function getModelById(id: ModelId): ModelInfo;
export function getModelById(id: string): ModelInfo | undefined;
export function getModelById(id: string): ModelInfo | undefined {
  if (Object.prototype.hasOwnProperty.call(MODEL_BY_ID, id)) {
    return MODEL_BY_ID[id as ModelId];
  }
  return undefined;
}
