import type { ReasoningChoices } from "../modelsDev";

/**
 * The vendor id this extension registers its language model provider under.
 *
 * It is deliberately not `minimax`: the original extension (published as
 * `DenizhanDaklr.minimax-vscode`) registers that one, and two providers with
 * the same vendor id would collide in the model picker. With its own id, both
 * extensions can be installed side by side.
 */
export const VENDOR_ID = "minimax-anthropic";

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
  /** Live ids are whatever MiniMax lists; the static catalog ids are a subset. */
  id: string;
  name: string;
  contextLength: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCall: boolean;
  /** Reasoning controls offered for this model, when the live data has any. */
  choices?: ReasoningChoices;
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

/**
 * Static fallback catalog.
 *
 * The live catalog (MiniMax's own `/models` endpoint, enriched with
 * models.dev) is the source of truth at runtime; this list keeps the picker
 * usable when the live list cannot be fetched (no network, offline start) and
 * carries the MiniMax-specific facts models.dev does not know, such as the
 * fact that M3.1 Flash always reasons.
 */
export const SUPPORTED_MODELS: readonly ModelInfo[] = [
  {
    id: "MiniMax-M3.1-Flash",
    name: "MiniMax M3.1 Flash",
    contextLength: CTX_1M,
    maxInputTokens: 1_000_000,
    maxOutputTokens: OUT_131K,
    imageInput: true,
    toolCall: true,
    // M3.1 Flash always thinks (at `max` depth unless told otherwise), and
    // thinking tokens are billed against `max_tokens`. A bigger default budget
    // keeps the visible answer from being squeezed out by the reasoning pass.
    defaultMaxTokens: 32_768,
  },
  {
    id: "MiniMax-M3",
    name: "MiniMax M3",
    contextLength: CTX_1M,
    maxInputTokens: 1_000_000,
    maxOutputTokens: OUT_131K,
    imageInput: true,
    toolCall: true,
  },
  { id: "MiniMax-M2.7", name: "MiniMax M2.7", contextLength: CTX_204K, maxInputTokens: 200_000, maxOutputTokens: OUT_131K, imageInput: false, toolCall: true },
  { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 (High-Speed)", contextLength: CTX_204K, maxInputTokens: 200_000, maxOutputTokens: OUT_131K, imageInput: false, toolCall: true },
  { id: "MiniMax-M2.5", name: "MiniMax M2.5", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K, imageInput: false, toolCall: true },
  { id: "MiniMax-M2.5-highspeed", name: "MiniMax M2.5 (High-Speed)", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K, imageInput: false, toolCall: true },
  { id: "MiniMax-M2.1", name: "MiniMax M2.1", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K, imageInput: false, toolCall: true },
  { id: "MiniMax-M2.1-highspeed", name: "MiniMax M2.1 (High-Speed)", contextLength: CTX_204K, maxInputTokens: 196_000, maxOutputTokens: OUT_128K, imageInput: false, toolCall: true },
  { id: "MiniMax-M2", name: "MiniMax M2", contextLength: CTX_204K, maxInputTokens: 192_000, maxOutputTokens: OUT_128K, imageInput: false, toolCall: true },
];

/**
 * Model ids MiniMax renamed when a preview model went generally available.
 *
 * `MiniMax-M3.1-Flash-Preview` became `MiniMax-M3.1-Flash` in October 2026.
 * The alias keeps `minimax.visibleModels` entries written against the preview
 * id working instead of silently dropping the model from the picker.
 */
export const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "MiniMax-M3.1-Flash-Preview": "MiniMax-M3.1-Flash",
};

/**
 * Map a possibly-legacy model id onto the current id. Unknown ids are
 * returned unchanged so callers can still report them as unsupported.
 */
export function resolveLegacyModelId(id: string): string {
  return LEGACY_MODEL_ALIASES[id] ?? id;
}

const MODEL_BY_ID: Readonly<Record<string, ModelInfo>> = Object.fromEntries(
  SUPPORTED_MODELS.map((model) => [model.id, model]),
);

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
    return MODEL_BY_ID[id];
  }
  return undefined;
}

/**
 * One entry from the provider's live `GET {baseUrl}/models`. Only the id is
 * guaranteed; the limit / modality fields are picked up when the provider
 * sends them.
 */
export interface LiveModelEntry {
  id: string;
  name?: string;
  context_window?: number;
  max_output_tokens?: number;
  input_modalities?: string[];
}

/**
 * Ids matching this pattern are never chat models (TTS / music / video /
 * etc.) and must not land in the chat model picker.
 */
export const NON_CHAT_MODEL_PATTERN =
  /embed|rerank|speech|video|music|tts|voice|image|whisper|moderation/i;

export function isChatModelId(id: string): boolean {
  return !NON_CHAT_MODEL_PATTERN.test(id);
}

/** Turn a raw model id into a readable name, e.g. `MiniMax-M3.1-Flash`. */
export function humanizeModelId(id: string): string {
  const parts = id.split(/[-_]+/).filter((part) => part.length > 0);
  const words = parts.map((part) => {
    if (part.toLowerCase() === "minimax") {
      return "MiniMax";
    }
    if (/^[a-z]*\d[\w.]*$/i.test(part)) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }
    if (/^v?\d+(\.\d+)*$/i.test(part)) {
      return part.toUpperCase().startsWith("V") ? part.toUpperCase() : part;
    }
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  });
  return words.join(" ");
}

interface ModelsApiShape {
  data?: Array<{
    id?: unknown;
    name?: unknown;
    display_name?: unknown;
    context_window?: unknown;
    max_output_tokens?: unknown;
    input_modalities?: unknown;
  }>;
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/**
 * `GET {baseUrl}/models` with the API key; returns chat-model entries only.
 *
 * Works for both endpoints: the Anthropic-compatible one
 * (`{anthropicBaseUrl}/v1/models`) and the OpenAI-compatible one
 * (`{apiBaseUrl}/models`). MiniMax accepts the key as `X-Api-Key` (the
 * Anthropic convention) or as `Authorization: Bearer` (the OpenAI one), so
 * both are sent.
 *
 * Throws on network/HTTP errors so the caller can keep the last good list.
 */
export async function fetchLiveModelCatalog(
  baseUrl: string,
  apiKey: string,
): Promise<LiveModelEntry[]> {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  const response = await fetchFn(`${normalizedBase}/models`, {
    method: "GET",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "X-Api-Key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`GET /models failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as ModelsApiShape;
  if (!body || !Array.isArray(body.data)) {
    throw new Error("GET /models returned an unexpected shape (missing data[])");
  }
  const entries: LiveModelEntry[] = [];
  for (const item of body.data) {
    if (!item || typeof item.id !== "string" || item.id.length === 0) {
      continue;
    }
    if (!isChatModelId(item.id)) {
      continue;
    }
    const entry: LiveModelEntry = { id: item.id };
    // The Anthropic-compatible endpoint calls it `display_name`.
    const name = typeof item.name === "string" ? item.name : item.display_name;
    if (typeof name === "string" && name.length > 0) {
      entry.name = name;
    }
    const contextWindow = readPositiveInt(item.context_window);
    if (contextWindow !== undefined) {
      entry.context_window = contextWindow;
    }
    const maxOutput = readPositiveInt(item.max_output_tokens);
    if (maxOutput !== undefined) {
      entry.max_output_tokens = maxOutput;
    }
    if (Array.isArray(item.input_modalities)) {
      const modalities = item.input_modalities.filter(
        (modality): modality is string => typeof modality === "string",
      );
      if (modalities.length > 0) {
        entry.input_modalities = modalities;
      }
    }
    entries.push(entry);
  }
  return entries;
}
