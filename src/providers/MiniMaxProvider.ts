import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { MiniMaxError } from "../api/MiniMaxError";
import {
  SUPPORTED_MODELS,
  fetchLiveModelCatalog,
  humanizeModelId,
  resolveModelIdForApi,
  type LiveModelEntry,
  type ModelInfo,
} from "../api/types";
import type { MinimaxStreamClient } from "../api/MinimaxStreamClient";
import { MiniMaxOpenAIClient } from "../api/MiniMaxOpenAIClient";
import { MiniMaxAnthropicClient } from "../api/MiniMaxAnthropicClient";
import {
  reasoningChoices,
  resolveModelsDev,
  tokenLimits,
  type ModelsDevCache,
} from "../modelsDev";
import { convertMessages } from "../utils/MessageConverter";
import {
  getAnthropicBaseUrl,
  getApiBaseUrl,
  getApiFormat,
  getCatalogBaseUrl,
  getReasoningEffort,
  getThinkingMode,
  isReasoningEffortSetting,
  isThinkingMode,
  modelsWithApiKey,
  resolveMaxTokens,
  resolveReasoningRequest,
  resolveTemperature,
  resolveTopP,
  setApiFormat,
  setReasoningEffort,
  setThinkingMode,
  type ApiFormat,
  type ThinkingMode,
} from "../utils/ModelConfig";
import {
  getThinkingPartCtor,
  InlineThinkingParser,
} from "../utils/ThinkingHelper";
import { TokenCounter } from "../utils/TokenCounter";
import {
  convertTools,
  resolveToolChoice,
  type AccumulatedToolCall,
} from "../utils/ToolConverter";
import { MiniMaxErrorMapper } from "./ErrorMapper";
import { MiniMaxAuthentication } from "./MiniMaxAuthentication";

type PrepareOptionsWithConfiguration = vscode.PrepareLanguageModelChatModelOptions & {
  configuration?: Record<string, unknown>;
};

type ResponseOptionsWithEffort = vscode.ProvideLanguageModelChatResponseOptions & {
  modelConfiguration?: { reasoningEffort?: unknown };
  configuration?: { reasoningEffort?: unknown };
};

export class MiniMaxProvider
  implements vscode.LanguageModelChatProvider, vscode.Disposable
{
  private readonly modelsChangedEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.modelsChangedEmitter.event;

  private readonly modelApiKeys = new Map<string, string>();

  /** Live catalog served to the picker. */
  private availableModels: readonly ModelInfo[] = [];
  /** Cache scope: hash of endpoint + account, so a key change re-reads. */
  private catalogScope: string | undefined;
  private refreshGeneration = 0;
  private lastCatalogWarning: string | undefined;
  private readonly catalogOutput = vscode.window.createOutputChannel("MiniMax");
  private devCache: ModelsDevCache | undefined;
  /** The key VS Code hands us (Manage Models); requests use it, so refreshes do too. */
  private refreshKey: string | undefined;
  private readonly refreshTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly authManager: MiniMaxAuthentication,
    private readonly tokenCounter: TokenCounter,
    private readonly context: vscode.ExtensionContext,
  ) {
    void this.refreshModels();
    this.refreshTimer = setInterval(() => {
      void this.refreshModels();
    }, 30 * 60 * 1000);
  }

  dispose(): void {
    ++this.refreshGeneration;
    clearInterval(this.refreshTimer);
    this.catalogOutput.dispose();
    this.modelsChangedEmitter.dispose();
  }

  private createClient(): MinimaxStreamClient {
    const format = getApiFormat();
    if (format === "anthropic-compat") {
      return new MiniMaxAnthropicClient(getAnthropicBaseUrl());
    }
    return new MiniMaxOpenAIClient(getApiBaseUrl());
  }

  notifyModelsChanged(): void {
    this.modelsChangedEmitter.fire();
  }

  clearApiKeyCache(): void {
    this.modelApiKeys.clear();
  }

  /**
   * Re-read `GET {baseUrl}/models`, resolve limits from the provider fields
   * first and models.dev second, persist the result, and fire
   * onDidChange only when the served list actually changed.
   */
  async refreshModels(): Promise<void> {
    let apiKey = this.refreshKey;
    try {
      apiKey ??= await this.authManager.getApiKey();
      apiKey = this.refreshKey ?? apiKey;
    } catch {
      return;
    }
    if (!apiKey || apiKey.trim().length === 0) {
      return;
    }
    const baseUrl = getCatalogBaseUrl();
    const scope = catalogScope(baseUrl, apiKey.trim());
    const generation = ++this.refreshGeneration;
    if (scope !== this.catalogScope) {
      this.catalogScope = scope;
      const persisted = readPersistedCatalog(this.context.globalState, scope);
      this.availableModels = persisted.models;
      this.devCache = persisted.devCache;
      this.modelApiKeys.clear();
      this.notifyModelsChanged();
    }
    let live: LiveModelEntry[];
    try {
      live = await fetchLiveModelCatalog(baseUrl, apiKey.trim());
    } catch (error) {
      if (generation === this.refreshGeneration) {
        this.reportCatalogWarning(
          "Could not refresh the MiniMax model list",
          baseUrl,
          error,
        );
        // Offline (or the key is not accepted yet): fall back to the static
        // catalog so the picker is not empty.
        if (this.availableModels.length === 0) {
          this.availableModels = buildStaticCatalog();
          this.notifyModelsChanged();
        }
      }
      return;
    }
    if (generation !== this.refreshGeneration) {
      return;
    }
    const ids = live.map((entry) => entry.id);
    let nextDevCache: ModelsDevCache;
    try {
      nextDevCache = await resolveModelsDev(baseUrl, ids, this.devCache);
      if (generation === this.refreshGeneration) {
        this.lastCatalogWarning = undefined;
      }
    } catch (error) {
      if (generation !== this.refreshGeneration) {
        return;
      }
      // Metadata enrichment must never veto the authoritative live model ids.
      nextDevCache = this.devCache ?? { models: {} };
      this.reportCatalogWarning(
        "Could not refresh models.dev metadata; using cached metadata or default limits for live models",
        baseUrl,
        error,
      );
    }
    if (generation !== this.refreshGeneration) {
      return;
    }
    const built = buildCatalog(live, nextDevCache);
    this.catalogOutput.appendLine(
      `Loaded ${built.length} live chat models from ${baseUrl}/models.`,
    );
    this.devCache = nextDevCache;
    if (JSON.stringify(built) === JSON.stringify(this.availableModels)) {
      return;
    }
    this.availableModels = built;
    try {
      await this.context.globalState.update(MODEL_CATALOG_CACHE_KEY, {
        scope,
        devCache: nextDevCache,
        models: built,
      });
    } catch {
      // Cache is best-effort; the in-memory list is already updated.
    }
    if (generation === this.refreshGeneration) {
      this.notifyModelsChanged();
    }
  }

  private reportCatalogWarning(
    message: string,
    baseUrl: string,
    error: unknown,
  ): void {
    // Never log response bodies or raw network errors: they may contain
    // credentials.
    const status =
      error instanceof Error ? /HTTP (\d{3})/.exec(error.message)?.[1] : undefined;
    const warning = `${message}${
      status ? ` (HTTP ${status})` : ""
    }. Check minimax.apiBaseUrl, the matching region's M Plan Subscription Key, and network access. See Output > MiniMax.`;
    this.catalogOutput.appendLine(
      `${message} at ${baseUrl}${status ? ` (HTTP ${status})` : ""}.`,
    );
    if (this.lastCatalogWarning !== warning) {
      this.lastCatalogWarning = warning;
      void vscode.window.showWarningMessage(warning);
    }
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const optionsWithConfig = options as PrepareOptionsWithConfiguration;
    const configuredApiKey = this.extractConfiguredApiKey(optionsWithConfig);
    await this.applyConfiguredPreferences(optionsWithConfig);
    if (!configuredApiKey) {
      this.modelApiKeys.clear();
      return [];
    }

    // Make sure the catalog matches the account / endpoint in use before we
    // serve it.
    await this.syncCatalog(configuredApiKey);
    if (
      this.catalogScope !==
      catalogScope(getCatalogBaseUrl(), configuredApiKey)
    ) {
      return [];
    }

    const models = modelsWithApiKey(this.availableModels);
    this.modelApiKeys.clear();
    for (const model of models) {
      this.modelApiKeys.set(model.id, configuredApiKey);
    }

    return models;
  }

  /** Refresh and await a changed account/endpoint before serving its catalog. */
  private async syncCatalog(apiKey: string): Promise<void> {
    const baseUrl = getCatalogBaseUrl();
    const scope = catalogScope(baseUrl, apiKey);
    if (
      scope === this.catalogScope &&
      apiKey === this.refreshKey &&
      this.availableModels.length > 0
    ) {
      return;
    }
    this.refreshKey = apiKey;
    await this.refreshModels();
    // A background refresh (the periodic one, or the one started on
    // activation) can supersede the refresh we just started, which then
    // discards its own result. Retry once so the catalog we are about to
    // serve is really for this account.
    if (this.catalogScope !== scope || this.availableModels.length === 0) {
      await this.refreshModels();
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey =
      this.modelApiKeys.get(model.id) ?? (await this.authManager.getOrPromptApiKey());

    if (!apiKey) {
      throw new Error("API key not configured. Use the API key navigation action in the MiniMax model picker.");
    }

    try {
      await this.streamResponse(model, messages, options, progress, token, apiKey);
    } catch (error) {
      if (error instanceof MiniMaxError && error.statusCode === 401) {
        await this.authManager.deleteApiKey();
        this.notifyModelsChanged();
        const newKey = await this.authManager.promptForApiKey();
        this.modelApiKeys.clear();
        if (newKey) {
          this.modelApiKeys.set(model.id, newKey);
          this.notifyModelsChanged();
          await this.streamResponse(model, messages, options, progress, token, newKey);
          return;
        }
        this.notifyModelsChanged();
        throw new Error("Invalid API key. Please set a new one using the API key navigation action in the MiniMax model picker.");
      }
      await MiniMaxErrorMapper.throwMappedError(error, this.authManager);
    }
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Thenable<number> {
    if (typeof text === "string") {
      return Promise.resolve(this.tokenCounter.estimateTokens(text));
    }
    return Promise.resolve(
      this.tokenCounter.estimatePayload(convertMessages([text])),
    );
  }

  private async streamResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    apiKey: string,
  ): Promise<void> {
    const resolvedModel = this.findModel(model.id);
    if (!resolvedModel) {
      throw new Error(`Unsupported model "${model.id}" for MiniMax (coding / Token Plan).`);
    }

    const thinkingPartCtor = getThinkingPartCtor();
    const inlineParser = new InlineThinkingParser();
    const pendingToolCalls = new Map<number, AccumulatedToolCall>();
    const emittedToolCallIndices = new Set<number>();
    let pendingTrailingContent = "";
    let usageInputTokens = 0;
    let usageOutputTokens = 0;
    const tools = convertTools(options.tools);

    // Split system message out so the Anthropic adapter can put it in the
    // `system` field, while the OpenAI adapter keeps it in the messages array.
    const converted = convertMessages(messages);
    const systemParts: string[] = [];
    const nonSystemMessages: typeof converted = [];
    for (const m of converted) {
      if (m.role === "system") {
        systemParts.push(typeof m.content === "string" ? m.content : "");
      } else {
        nonSystemMessages.push(m);
      }
    }

    const toolChoice = resolveToolChoice(options, tools);
    const topP = resolveTopP(options);
    const requestChars = this.tokenCounter.payloadChars({
      messages: converted,
      tools: tools ?? [],
    });

    // Reasoning controls: the per-model picker value wins, then the global
    // settings, then the endpoint default.
    const optionsWithEffort = options as ResponseOptionsWithEffort;
    const configuredEffort =
      optionsWithEffort.modelConfiguration?.reasoningEffort ??
      optionsWithEffort.configuration?.reasoningEffort;
    const reasoning = resolveReasoningRequest(
      resolvedModel,
      configuredEffort,
      getApiFormat(),
    );

    const client = this.createClient();
    const stream = client.streamChat({
      apiKey,
      model: resolveModelIdForApi(resolvedModel.id),
      maxTokens: resolveMaxTokens(options, resolvedModel),
      temperature: resolveTemperature(options),
      topP,
      tools,
      toolChoice: toolChoice ?? "auto",
      reasoningSplit: true,
      ...(reasoning.thinking ? { thinking: reasoning.thinking } : {}),
      ...(reasoning.effort ? { reasoningEffort: reasoning.effort } : {}),
      cancellationToken: token,
      messages: nonSystemMessages,
      systemPrompt: systemParts.join("\n\n") || undefined,
    });

    for await (const event of stream) {
      if (token.isCancellationRequested) {
        return;
      }
      switch (event.kind) {
        case "thinking": {
          if (event.text && thinkingPartCtor) {
            progress.report(
              new thinkingPartCtor(event.text) as vscode.LanguageModelResponsePart,
            );
          } else if (event.text) {
            progress.report(
              new vscode.LanguageModelTextPart(`[thinking]${event.text}[/thinking]`),
            );
          }
          break;
        }
        case "text": {
          const { cleaned, thinking: inlineThinking } = inlineParser.feed(event.text);
          if (inlineThinking && thinkingPartCtor) {
            progress.report(
              new thinkingPartCtor(inlineThinking) as vscode.LanguageModelResponsePart,
            );
          } else if (inlineThinking) {
            progress.report(
              new vscode.LanguageModelTextPart(`[thinking]${inlineThinking}[/thinking]`),
            );
          }
          if (cleaned) {
            // Buffer trailing content so a stray </think> arriving in a later event
            // can be paired and discarded before the user sees it.
            const combined = pendingTrailingContent + cleaned;
            const strayClose = combined.indexOf("</think>");
            if (strayClose !== -1) {
              const safe = combined.slice(0, strayClose);
              if (safe) {
                progress.report(new vscode.LanguageModelTextPart(safe));
              }
              pendingTrailingContent = "";
            } else {
              pendingTrailingContent = combined;
            }
          }
          break;
        }
        case "tool_use_start": {
          const current: AccumulatedToolCall =
            pendingToolCalls.get(event.index) ?? {
              index: event.index,
              arguments: "",
            };
          current.id = event.id;
          current.name = event.name;
          pendingToolCalls.set(event.index, current);
          break;
        }
        case "tool_use_delta": {
          const current: AccumulatedToolCall =
            pendingToolCalls.get(event.index) ?? {
              index: event.index,
              arguments: "",
            };
          current.arguments += event.partialJson;
          pendingToolCalls.set(event.index, current);
          break;
        }
        case "tool_use_stop": {
          const call = pendingToolCalls.get(event.index);
          if (call) {
            this.emitToolCall(progress, call, emittedToolCallIndices);
          }
          break;
        }
        case "content_block_start":
          // Informational only on this path; nothing to do in the provider loop.
          break;
        case "usage": {
          // Collect the real token usage so it can be reported once the
          // stream is done, and learn the request-size ratio so the context
          // estimate stays honest.
          if (typeof event.inputTokens === "number") {
            usageInputTokens = event.inputTokens;
          }
          if (typeof event.outputTokens === "number") {
            usageOutputTokens = event.outputTokens;
          }
          break;
        }
        case "finish": {
          this.emitToolCalls(progress, pendingToolCalls, emittedToolCallIndices);
          break;
        }
        default: {
          // Exhaustiveness check.
          const _exhaustive: never = event;
          void _exhaustive;
        }
      }
    }

    // Flush any content buffered while waiting for a possible stray </think>.
    if (pendingTrailingContent) {
      progress.report(new vscode.LanguageModelTextPart(pendingTrailingContent));
      pendingTrailingContent = "";
    }

    // Report the token usage of this request once the stream is complete.
    if (usageInputTokens > 0 || usageOutputTokens > 0) {
      this.reportUsage(
        progress,
        requestChars,
        usageInputTokens,
        usageOutputTokens,
      );
    }
  }

  private emitToolCalls(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    pendingToolCalls: Map<number, AccumulatedToolCall>,
    emittedIndices: Set<number>,
  ): void {
    const ordered = [...pendingToolCalls.values()].sort((a, b) => a.index - b.index);
    for (const call of ordered) {
      this.emitToolCall(progress, call, emittedIndices);
    }
  }

  /**
   * Report the token usage of the request as a data part so the chat UI can
   * show it, and calibrate the request-size estimator with the real numbers.
   */
  private reportUsage(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    requestChars: number,
    inputTokens: number,
    outputTokens: number,
  ): void {
    if (inputTokens > 0) {
      this.tokenCounter.calibrate(requestChars, inputTokens);
    }
    if (inputTokens <= 0 && outputTokens <= 0) {
      return;
    }
    const payload = JSON.stringify({
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    });
    const DataPartCtor = vscode.LanguageModelDataPart as unknown as new (
      data: Uint8Array,
      mimeType: string,
    ) => vscode.LanguageModelResponsePart;
    progress.report(
      new DataPartCtor(new TextEncoder().encode(payload), "usage"),
    );
  }

  private findModel(id: string): ModelInfo | undefined {
    return this.availableModels.find((model) => model.id === id);
  }

  private emitToolCall(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    call: AccumulatedToolCall,
    emittedIndices: Set<number>,
  ): void {
    if (!call.id || !call.name || emittedIndices.has(call.index)) {
      return;
    }
    emittedIndices.add(call.index);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(call.arguments);
    } catch {
      parsed = {};
    }
    progress.report(
      new vscode.LanguageModelToolCallPart(call.id, call.name, parsed as object),
    );
  }

  /**
   * The chat UI's "Manage Language Models" flow passes the values entered for
   * the `languageModelChatProviders` configuration schema (apiFormat,
   * thinkingMode) alongside the API key. Persist them to user settings so
   * the rest of the extension picks them up.
   *
   * `thinkingMode` is the new tri-state dropdown exposed next to the model
   * picker; we still accept the legacy `thinkingEnabled` boolean for users
   * who migrated from the previous settings-only UI.
   */
  private async applyConfiguredPreferences(
    options: PrepareOptionsWithConfiguration,
  ): Promise<void> {
    const config = options.configuration;
    if (!config || typeof config !== "object") {
      return;
    }

    const format = config.apiFormat;
    if (
      (format === "openai-compat" || format === "anthropic-compat") &&
      format !== getApiFormat()
    ) {
      await setApiFormat(format as ApiFormat);
    }

    const mode = config.thinkingMode;
    if (isThinkingMode(mode) && mode !== getThinkingMode()) {
      await setThinkingMode(mode);
      return;
    }
    // Legacy boolean: only apply if the new tri-state key wasn't set in this
    // same picker dialog (otherwise we'd clobber an explicit dropdown choice).
    if (config.thinkingMode === undefined) {
      const legacy = config.thinkingEnabled;
      if (typeof legacy === "boolean") {
        const mapped: ThinkingMode = legacy ? "adaptive" : "off";
        if (mapped !== getThinkingMode()) {
          await setThinkingMode(mapped);
        }
      }
    }

    const effort = config.reasoningEffort;
    if (isReasoningEffortSetting(effort) && effort !== getReasoningEffort()) {
      await setReasoningEffort(effort);
    }
  }

  private extractConfiguredApiKey(
    options: PrepareOptionsWithConfiguration,
  ): string | undefined {
    const config = options.configuration;
    if (!config || typeof config !== "object") {
      return undefined;
    }

    const apiKey = config.apiKey;
    if (typeof apiKey !== "string") {
      return undefined;
    }

    const normalized = apiKey.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}

const MODEL_CATALOG_CACHE_KEY = "minimax.modelCatalog.v1";
const DEFAULT_API_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_CONTEXT = 131_072;
const DEFAULT_MAX_OUTPUT = 32_768;

/**
 * Thinking depths MiniMax documents for the models that expose them. models.dev
 * carries the same list, but the static copy keeps the picker correct when the
 * models.dev catalog is unreachable.
 */
const KNOWN_REASONING_LEVELS: Record<string, readonly string[]> = {
  "MiniMax-M3.1-Flash": ["low", "medium", "high", "xhigh", "max"],
  "MiniMax-M3.1-Flash-Preview": ["low", "medium", "high", "xhigh", "max"],
};

/**
 * Build the served catalog from the live model list.
 *
 * Limits come from the provider's own fields first, then models.dev, then the
 * static catalog, then safe defaults — so a model MiniMax ships before
 * models.dev catalogs it still shows up, with limits that get corrected on the
 * next refresh.
 */
function buildCatalog(
  live: readonly LiveModelEntry[],
  dev: ModelsDevCache,
): ModelInfo[] {
  const staticById = new Map(SUPPORTED_MODELS.map((model) => [model.id, model]));
  const models: ModelInfo[] = [];
  for (const entry of live) {
    const devModel = dev.models[entry.id] ?? undefined;
    const staticModel = staticById.get(entry.id);

    const context = firstPositive(
      entry.context_window,
      devModel?.limit?.context,
      staticModel?.contextLength,
      DEFAULT_CONTEXT,
    );
    const maxOutput = firstPositive(
      entry.max_output_tokens,
      devModel?.limit?.output,
      staticModel?.maxOutputTokens,
      DEFAULT_MAX_OUTPUT,
    );
    const limits = tokenLimits(context, maxOutput);

    const inputModalities =
      entry.input_modalities ?? devModel?.modalities?.input;
    const imageInput = Array.isArray(inputModalities)
      ? inputModalities.includes("image")
      : (staticModel?.imageInput ?? false);

    const levels = KNOWN_REASONING_LEVELS[entry.id];
    const choices = reasoningChoices(devModel?.reasoning_options, {
      levels: levels ? [...levels] : undefined,
    });

    models.push({
      id: entry.id,
      name: entry.name ?? devModel?.name ?? staticModel?.name ?? humanizeModelId(entry.id),
      contextLength: limits.maxContextWindowTokens,
      maxInputTokens: limits.maxInputTokens,
      maxOutputTokens: limits.maxOutputTokens,
      imageInput,
      toolCall: devModel?.tool_call !== false && (staticModel?.toolCall ?? true),
      ...(choices ? { choices } : {}),
      ...(staticModel?.defaultMaxTokens
        ? { defaultMaxTokens: staticModel.defaultMaxTokens }
        : {}),
    });
  }
  return models;
}

function firstPositive(...values: (number | undefined)[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

/**
 * The static catalog, used when the live list cannot be fetched. It keeps the
 * picker usable offline, at the cost of possibly listing a model the account
 * cannot reach.
 */
function buildStaticCatalog(): ModelInfo[] {
  return SUPPORTED_MODELS.map((model) => {
    const limits = tokenLimits(model.contextLength, model.maxOutputTokens);
    return {
      ...model,
      contextLength: limits.maxContextWindowTokens,
      maxInputTokens: limits.maxInputTokens,
      maxOutputTokens: limits.maxOutputTokens,
    };
  });
}

function catalogScope(baseUrl: string, apiKey: string): string {
  // Bind the cache to the endpoint AND account without persisting the API key.
  return createHash("sha256")
    .update(
      JSON.stringify([baseUrl.trim().replace(/\/+$/, ""), apiKey.trim()]),
    )
    .digest("hex");
}

interface PersistedCatalog {
  scope?: string;
  devCache?: unknown;
  models?: unknown;
}

function readPersistedCatalog(
  globalState: vscode.Memento,
  scope: string,
): {
  devCache: ModelsDevCache | undefined;
  models: ModelInfo[];
} {
  try {
    const cached = globalState.get<PersistedCatalog>(MODEL_CATALOG_CACHE_KEY);
    if (cached?.scope !== scope) {
      return { devCache: undefined, models: [] };
    }
    const devCache = isValidDevCache(cached?.devCache)
      ? cached.devCache
      : undefined;
    const models = Array.isArray(cached?.models)
      ? cached.models.filter(isValidPersistedModel)
      : [];
    return { devCache, models };
  } catch {
    return { devCache: undefined, models: [] };
  }
}

function isValidDevCache(value: unknown): value is ModelsDevCache {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { models?: unknown };
  return (
    !!candidate.models &&
    typeof candidate.models === "object" &&
    !Array.isArray(candidate.models)
  );
}

function isValidPersistedModel(value: unknown): value is ModelInfo {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.contextLength !== "number" ||
    typeof candidate.maxInputTokens !== "number" ||
    typeof candidate.maxOutputTokens !== "number" ||
    typeof candidate.imageInput !== "boolean"
  ) {
    return false;
  }
  if (candidate.choices !== undefined && !isValidPersistedChoices(candidate.choices)) {
    return false;
  }
  return true;
}

function isValidPersistedChoices(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { values?: unknown; defaultValue?: unknown };
  return (
    Array.isArray(candidate.values) &&
    candidate.values.every((entry) => typeof entry === "string") &&
    typeof candidate.defaultValue === "string"
  );
}
