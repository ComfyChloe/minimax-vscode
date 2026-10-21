import * as vscode from "vscode";
import {
  resolveLegacyModelId,
  type ModelId,
  type ModelInfo,
  type ReasoningEffort,
} from "../api/types";
import {
  reasoningSchema,
  resolveReasoningChoice,
  tokenLimits,
  type ReasoningChoices,
} from "../modelsDev";

export const CONFIG_SECTION = "minimax";
export const VISIBLE_MODELS_KEY = "visibleModels";
export const API_BASE_URL_KEY = "apiBaseUrl";
/**
 * Legacy boolean key retained for backward compatibility with the old
 * settings UI and existing user configs. The chat-model picker surfaces the
 * newer {@link THINKING_MODE_KEY} dropdown; this key is still honored when
 * present so prior installs don't silently change behavior.
 */
export const THINKING_ENABLED_KEY = "thinkingEnabled";
export const THINKING_MODE_KEY = "thinkingMode";
export const REASONING_EFFORT_KEY = "reasoningEffort";
export const API_FORMAT_KEY = "apiFormat";
export const ANTHROPIC_BASE_URL_KEY = "anthropicBaseUrl";
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_MAX_TOKENS = 8192;

export type ApiFormat = "openai-compat" | "anthropic-compat";

/**
 * Thinking control surfaced in the chat-model picker.
 *
 * - `off`      — never emit thinking blocks. On M3 this maps to
 *                `thinking: {"type":"disabled"}`. M2.x accepts the field but
 *                still thinks, so for those models `off` is effectively
 *                advisory (the docs say thinking cannot be disabled).
 * - `adaptive` — always-on thinking. Maps to `thinking: {"type":"adaptive"}`.
 * - `auto`     — let the API / model decide. For Anthropic-compat that means
 *                thinking OFF for M3 (the Anthropic endpoint default) and ON
 *                for M2.x (which can't be disabled anyway). For OpenAI-compat
 *                that means thinking ON for M3 (the OpenAI endpoint default)
 *                and ON for M2.x. Concretely: omit the `thinking` field on
 *                the wire so the endpoint's own default takes effect.
 */
export type ThinkingMode = "off" | "adaptive" | "auto";

const THINKING_MODES: readonly ThinkingMode[] = ["off", "adaptive", "auto"];

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === "string" && (THINKING_MODES as readonly string[]).includes(value);
}

/**
 * Returns the currently configured thinking mode. Falls back through the
 * legacy `thinkingEnabled` boolean so older user configs keep their previous
 * behavior. Default is `adaptive` (think on), which matches the historical
 * default where `thinkingEnabled` was undefined → true.
 */
export function getThinkingMode(): ThinkingMode {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const mode = config.get<unknown>(THINKING_MODE_KEY);
  if (isThinkingMode(mode)) {
    return mode;
  }
  // Legacy fallback: honor the old boolean if it was explicitly set.
  const legacy = config.get<unknown>(THINKING_ENABLED_KEY);
  if (typeof legacy === "boolean") {
    return legacy ? "adaptive" : "off";
  }
  return "adaptive";
}

export async function setThinkingMode(mode: ThinkingMode): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(THINKING_MODE_KEY, mode, vscode.ConfigurationTarget.Global);
  // Keep the legacy boolean in sync so anything still reading it stays
  // consistent (commands, status bar, persisted user setting).
  await config.update(
    THINKING_ENABLED_KEY,
    mode !== "off",
    vscode.ConfigurationTarget.Global,
  );
}

export function thinkingModeLabel(mode: ThinkingMode): string {
  switch (mode) {
    case "off":
      return "Off";
    case "adaptive":
      return "On (adaptive)";
    case "auto":
      return "Auto";
  }
}

export function thinkingModeDescription(mode: ThinkingMode): string {
  switch (mode) {
    case "off":
      return "Disable thinking for M3 (faster, no reasoning tokens). M2.x and M3.1 Flash cannot disable thinking.";
    case "adaptive":
      return "Always-on thinking for M3 (`thinking: {\"type\":\"adaptive\"}`). M2.x and M3.1 Flash always think.";
    case "auto":
      return "Use the endpoint default — Anthropic: off for M3, on for M2.x. OpenAI: on for M3, on for M2.x.";
  }
}

/**
 * Resolve the wire-format thinking control for a given (mode, model, format).
 *
 * Returns one of:
 * - `{ type: "disabled" }`   → send `thinking: {"type":"disabled"}`
 * - `{ type: "adaptive" }`   → send `thinking: {"type":"adaptive"}`
 * - `undefined`               → omit the field entirely (auto / model-controlled)
 */
export function resolveThinkingControl(
  mode: ThinkingMode,
  model: ModelInfo,
  format: ApiFormat,
): { type: "adaptive" } | { type: "disabled" } | undefined {
  // M3.1 Flash requires reasoning; disabling it returns HTTP 400.
  if (ALWAYS_THINKING_MODELS.has(model.id)) {
    return { type: "adaptive" };
  }

  if (mode === "adaptive") {
    return { type: "adaptive" };
  }
  if (mode === "off") {
    return { type: "disabled" };
  }
  // mode === "auto": honor the endpoint's own default.
  if (model.id === "MiniMax-M3") {
    if (format === "anthropic-compat") {
      // Anthropic-compat: thinking is OFF by default for M3.
      return undefined;
    }
    // OpenAI-compat: thinking is ON by default for M3.
    return { type: "adaptive" };
  }
  // M2.x cannot disable thinking; auto → omit so the endpoint defaults to ON.
  return undefined;
}

/**
 * Thinking-depth levels offered for models that support them.
 *
 * `auto` leaves the field off the wire so the endpoint applies its own
 * default (currently `max` for M3.1 Flash).
 */
export type ReasoningEffortSetting = "auto" | ReasoningEffort;

const REASONING_EFFORT_SETTINGS: readonly ReasoningEffortSetting[] = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function isReasoningEffortSetting(
  value: unknown,
): value is ReasoningEffortSetting {
  return (
    typeof value === "string" &&
    (REASONING_EFFORT_SETTINGS as readonly string[]).includes(value)
  );
}

/**
 * The configured thinking depth. `auto` (the default) omits the field so the
 * endpoint decides, which for M3.1 Flash means `max`.
 */
export function getReasoningEffort(): ReasoningEffortSetting {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const value = config.get<unknown>(REASONING_EFFORT_KEY);
  return isReasoningEffortSetting(value) ? value : "auto";
}

export async function setReasoningEffort(
  effort: ReasoningEffortSetting,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(
    REASONING_EFFORT_KEY,
    effort,
    vscode.ConfigurationTarget.Global,
  );
}

export function reasoningEffortLabel(effort: ReasoningEffortSetting): string {
  return effort === "auto" ? "Auto" : effort.toUpperCase();
}

/**
 * Resolve the wire-format thinking depth for a model.
 *
 * Only M3.1 Flash exposes a tunable depth (`output_config.effort` on the
 * Anthropic-compatible endpoint, `reasoning_effort` on the OpenAI-compatible
 * one). Every other model returns `undefined`, so nothing extra is sent.
 */
export function resolveReasoningEffort(
  model: ModelInfo,
): ReasoningEffort | undefined {
  if (!ALWAYS_THINKING_MODELS.has(model.id)) {
    return undefined;
  }
  const effort = getReasoningEffort();
  return effort === "auto" ? undefined : effort;
}

/** The thinking control and depth to put on the wire for one request. */
export interface ReasoningRequest {
  thinking?: { type: "adaptive" } | { type: "disabled" };
  effort?: ReasoningEffort;
}

/**
 * Resolve the reasoning controls for a request.
 *
 * Precedence:
 * 1. the per-model picker value Copilot sends with the model
 *    (`modelConfiguration.reasoningEffort`),
 * 2. the global `minimax.reasoningEffort` setting,
 * 3. the global thinking mode (`off` / `adaptive` / `auto`).
 *
 * Models without live reasoning controls fall back to the global thinking
 * mode, and models that always reason never get `thinking: disabled` (the
 * API answers 400 for it).
 */
export function resolveReasoningRequest(
  model: ModelInfo,
  configured: unknown,
  format: ApiFormat,
): ReasoningRequest {
  const choices = model.choices;
  if (choices) {
    const choice = resolvePickerChoice(choices, configured);
    if (choice === "off") {
      return { thinking: { type: "disabled" } };
    }
    if (choice === "on") {
      return { thinking: { type: "adaptive" } };
    }
    if (choice !== undefined && choice !== "auto") {
      return {
        thinking: { type: "adaptive" },
        effort: choice as ReasoningEffort,
      };
    }
    // "auto": send nothing and let the endpoint decide.
    return {};
  }

  const thinking = resolveThinkingControl(getThinkingMode(), model, format);
  const effort = resolveReasoningEffort(model);
  return {
    ...(thinking ? { thinking } : {}),
    ...(effort ? { effort } : {}),
  };
}

/**
 * The value to use for a model that offers live reasoning controls: the
 * picker's value when it is still offered, else the global settings, else the
 * model's own default.
 */
function resolvePickerChoice(
  choices: ReasoningChoices,
  configured: unknown,
): string | undefined {
  if (
    typeof configured === "string" &&
    choices.values.includes(configured)
  ) {
    return configured;
  }
  const globalEffort = getReasoningEffort();
  if (globalEffort !== "auto" && choices.values.includes(globalEffort)) {
    return globalEffort;
  }
  const mode = getThinkingMode();
  if (mode === "off" && choices.values.includes("off")) {
    return "off";
  }
  if (mode === "adaptive" && choices.values.includes("on")) {
    return "on";
  }
  return resolveReasoningChoice(choices, configured);
}

/**
 * Legacy boolean accessor retained for existing call sites. Resolves the
 * current mode and the active format into a yes/no for the M3 default.
 *
 * Returns `true` when thinking is enabled in a way that would actually turn
 * it on for M3 (i.e. `adaptive`, or `auto` on the OpenAI endpoint). Returns
 * `false` for `off` or `auto` on the Anthropic endpoint (which is M3-off by
 * default).
 */
export function isThinkingEnabled(): boolean {
  const mode = getThinkingMode();
  if (mode === "adaptive") {
    return true;
  }
  if (mode === "off") {
    return false;
  }
  // auto: depends on the endpoint. Resolve against M3 + current format.
  const format = getApiFormat();
  return format === "openai-compat";
}

export function getApiFormat(): ApiFormat {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const value = config.get<unknown>(API_FORMAT_KEY);
  // The Anthropic-compatible Messages API is the default: it is the endpoint
  // MiniMax documents first, and the one every other Anthropic-compatible
  // client (Claude Code, Codex, Cursor, ...) talks to.
  return value === "openai-compat" ? "openai-compat" : "anthropic-compat";
}

export function apiFormatLabel(format: ApiFormat): string {
  return format === "anthropic-compat"
    ? "Anthropic API (Messages)"
    : "OpenAI API (Chat Completions)";
}

export async function setApiFormat(format: ApiFormat): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(API_FORMAT_KEY, format, vscode.ConfigurationTarget.Global);
}

/**
 * Legacy setter kept for the old `toggleThinking` command. Maps the new mode
 * world back onto the legacy boolean.
 */
export async function setThinkingEnabled(enabled: boolean): Promise<void> {
  await setThinkingMode(enabled ? "adaptive" : "off");
}

export function getAnthropicBaseUrl(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const url = config.get<string>(ANTHROPIC_BASE_URL_KEY);
  if (typeof url === "string" && url.trim().length > 0) {
    return url.trim();
  }
  return "https://api.minimax.io/anthropic";
}

export function getApiBaseUrl(): string | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const url = config.get<string>(API_BASE_URL_KEY);
  if (typeof url === "string" && url.trim().length > 0) {
    return url.trim();
  }
  return undefined;
}

/**
 * Base URL used to read the live model catalog.
 *
 * It follows the endpoint in use: the Anthropic-compatible API exposes its
 * model list at `{anthropicBaseUrl}/v1/models`, the OpenAI-compatible one at
 * `{apiBaseUrl}/models`.
 */
export function getCatalogBaseUrl(): string {
  if (getApiFormat() === "anthropic-compat") {
    return `${getAnthropicBaseUrl().replace(/\/+$/, "")}/v1`;
  }
  return (getApiBaseUrl() ?? "https://api.minimax.io/v1").replace(/\/+$/, "");
}

/**
 * Build the VS Code model picker entries for a catalog.
 *
 * `allModels` is the live catalog (MiniMax's own `/models` list, enriched
 * with models.dev). Models the user pinned through `minimax.visibleModels`
 * are shown first, the rest keep the catalog order.
 */
export function modelsWithApiKey(
  allModels: readonly ModelInfo[],
): vscode.LanguageModelChatInformation[] {
  const visibleModels = getVisibleModels(allModels);
  const format = getApiFormat();
  const sdkLabel =
    format === "anthropic-compat" ? "Anthropic API" : "OpenAI API";
  const mode = getThinkingMode();
  const thinkingLabel =
    mode === "off"
      ? "thinking off"
      : mode === "adaptive"
        ? "thinking on (adaptive)"
        : `thinking ${mode}`;
  const effort = getReasoningEffort();
  return visibleModels.map((model) => {
    const limits = tokenLimits(model.contextLength, model.maxOutputTokens);
    const alwaysThinks = ALWAYS_THINKING_MODELS.has(model.id);
    return {
      id: model.id,
      name: model.name,
      detail: `Token Plan · ${sdkLabel}`,
      tooltip: `${model.name} -- in ${limits.maxInputTokens.toLocaleString()} / out ${limits.maxOutputTokens.toLocaleString()} max tokens (context up to ${limits.maxContextWindowTokens.toLocaleString()}) · ${sdkLabel}${alwaysThinks ? ` · thinking always on${effort === "auto" ? "" : ` · effort ${effort}`}` : model.id === "MiniMax-M3" ? ` · ${thinkingLabel}` : ""}`,
      family: "minimax",
      version: getModelVersion(model.id),
      maxInputTokens: limits.maxInputTokens,
      maxOutputTokens: limits.maxOutputTokens,
      isUserSelectable: true,
      isBYOK: true,
      capabilities: {
        toolCalling: model.toolCall,
        imageInput: model.imageInput,
      },
      ...(model.choices ? { configurationSchema: reasoningSchema(model.choices) } : {}),
    } as unknown as vscode.LanguageModelChatInformation;
  });
}

/**
 * Models that always reason. Sending `thinking: {"type":"disabled"}` for
 * these returns HTTP 400, so they never offer an "off" choice.
 */
const ALWAYS_THINKING_MODELS = new Set(["MiniMax-M3.1-Flash", "MiniMax-M3.1-Flash-Preview"]);

function getModelVersion(modelId: string): string {
  switch (modelId) {
    case "MiniMax-M3.1-Flash":
      return "3.1-flash";
    case "MiniMax-M3":
      return "3";
    case "MiniMax-M2.7":
      return "2.7";
    case "MiniMax-M2.7-highspeed":
      return "2.7-highspeed";
    case "MiniMax-M2.5":
      return "2.5";
    case "MiniMax-M2.5-highspeed":
      return "2.5-highspeed";
    case "MiniMax-M2.1":
      return "2.1";
    case "MiniMax-M2.1-highspeed":
      return "2.1-highspeed";
    case "MiniMax-M2":
      return "2";
    default:
      return modelId;
  }
}

/**
 * Filter a catalog down to the models the user wants to see.
 *
 * `minimax.visibleModels` holds plain live ids (no enum); an empty list means
 * "show every live model". Ids that MiniMax renamed (the M3.1 Flash preview)
 * still resolve, so an existing list keeps working.
 */
export function getVisibleModels(allModels: readonly ModelInfo[]): readonly ModelInfo[] {
  if (allModels.length === 0) {
    return [];
  }
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const raw = config.get<unknown>(VISIBLE_MODELS_KEY);
  if (!Array.isArray(raw)) {
    return [...allModels];
  }

  const configuredIds = new Set(
    raw
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((id) => resolveLegacyModelId(id)),
  );
  if (configuredIds.size === 0) {
    return [...allModels];
  }
  const visibleModels = allModels.filter((model) => configuredIds.has(model.id));
  return visibleModels.length > 0 ? visibleModels : [...allModels];
}

export function resolveMaxTokens(
  options: vscode.ProvideLanguageModelChatResponseOptions,
  model: ModelInfo,
): number {
  const value = options.modelOptions?.maxTokens;
  const base =
    typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : (model.defaultMaxTokens ?? DEFAULT_MAX_TOKENS);
  return Math.min(base, model.maxOutputTokens);
}

export function resolveTemperature(
  options: vscode.ProvideLanguageModelChatResponseOptions,
): number {
  const value = options.modelOptions?.temperature;
  if (typeof value === "number" && value > 0 && value <= 1) {
    return value;
  }
  return DEFAULT_TEMPERATURE;
}

export function resolveTopP(
  options: vscode.ProvideLanguageModelChatResponseOptions,
): number | undefined {
  const optionsRecord = options.modelOptions as
    | { topP?: unknown; top_p?: unknown }
    | undefined;
  if (!optionsRecord) {
    return undefined;
  }
  const raw = optionsRecord.topP ?? optionsRecord.top_p;
  if (typeof raw === "number" && raw > 0 && raw <= 1) {
    return raw;
  }
  return undefined;
}

// Suppress unused-type-import lint for ModelId: this file no longer uses it
// directly, but downstream consumers reference the export from this module.
export type { ModelId };
