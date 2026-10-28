import * as vscode from "vscode";
import { imageTokenCost } from "./ImageTokenCost";

const CHARS_PER_TOKEN_KEY = "minimax.charsPerToken";

/**
 * How much the estimate is scaled up.
 *
 * The chat view compares our token count against the model's budget to decide
 * when to compact the conversation. Under-reporting means the request goes
 * out with a prompt that is already too long and the API answers with a
 * context-length error instead of a compaction. So the estimate deliberately
 * over-reports a little.
 */
const DEFAULT_SAFETY_MARGIN = 0.15;

/** Bounds for the learned chars-per-token ratio, so one odd response cannot skew it. */
const MIN_CHARS_PER_TOKEN = 2.5;
const MAX_CHARS_PER_TOKEN = 6;

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
];

/**
 * Estimates token counts for the context window indicator.
 *
 * The chars-per-token ratio starts at a rough 4 and is recalibrated from the
 * real `usage` numbers the API returns, so the estimate tracks the model and
 * the payload mix (code vs prose) instead of guessing.
 */
export class TokenCounter {
  private charsPerToken = 4;

  constructor(
    private readonly globalState?: vscode.Memento,
    private readonly safetyMargin: number = DEFAULT_SAFETY_MARGIN,
  ) {
    if (globalState) {
      const saved = globalState.get<number>(CHARS_PER_TOKEN_KEY);
      if (
        typeof saved === "number" &&
        Number.isFinite(saved) &&
        saved >= MIN_CHARS_PER_TOKEN &&
        saved <= MAX_CHARS_PER_TOKEN
      ) {
        this.charsPerToken = saved;
      }
    }
  }

  /** Tokens for a plain string. */
  estimateTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }
    return this.applyMargin(text.length / this.charsPerToken);
  }

  /** Tokens for an already provider-converted payload, with image data removed. */
  estimatePayload(value: unknown): number {
    return this.applyMargin(this.payloadChars(value) / this.charsPerToken);
  }

  /**
   * Tokens for one chat message.
   *
   * Text, tool calls and tool results are measured through the converted
   * payload; images are added separately, because their base64 payload is
   * stripped from the character count but they still cost real tokens.
   */
  estimateMessage(message: vscode.LanguageModelChatRequestMessage): number {
    const converted = convertMessageParts(message);
    let tokens = this.estimatePayload(converted);
    for (const part of message.content as readonly unknown[]) {
      if (part instanceof vscode.LanguageModelDataPart) {
        const mimeType = (part as { mimeType?: string }).mimeType ?? "";
        if (IMAGE_MIME_TYPES.includes(mimeType.toLowerCase())) {
          tokens += imageTokenCost(part.data, mimeType);
        }
      }
    }
    return tokens;
  }

  /** JSON length of a payload with image data (data URLs / base64) removed. */
  payloadChars(value: unknown): number {
    let json: string;
    try {
      json = JSON.stringify(value) ?? "";
    } catch {
      json = String(value);
    }
    return json.replace(/data:[^;"']+;base64,[A-Za-z0-9+/=\r\n]+/g, "data:stripped").length;
  }

  /** Recalibrate from a usage chunk: ratio of request chars to prompt tokens. */
  calibrate(requestChars: number, promptTokens: number): void {
    if (
      !Number.isFinite(requestChars) ||
      !Number.isFinite(promptTokens) ||
      requestChars <= 0 ||
      promptTokens <= 0
    ) {
      return;
    }
    const ratio = Math.min(
      MAX_CHARS_PER_TOKEN,
      Math.max(MIN_CHARS_PER_TOKEN, requestChars / promptTokens),
    );
    this.charsPerToken = 0.7 * this.charsPerToken + 0.3 * ratio;
    void this.globalState?.update(CHARS_PER_TOKEN_KEY, this.charsPerToken);
  }

  private applyMargin(tokens: number): number {
    return Math.max(1, Math.round(tokens * (1 + this.safetyMargin)));
  }
}

/**
 * The measurable text of a message: text parts, tool call arguments and tool
 * result contents. Images are handled separately by the caller.
 */
function convertMessageParts(
  message: vscode.LanguageModelChatRequestMessage,
): unknown {
  const parts: unknown[] = [];
  const content = message.content as readonly unknown[];
  for (const part of content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      parts.push(part.value);
      continue;
    }
    if (part instanceof vscode.LanguageModelToolCallPart) {
      parts.push(JSON.stringify(part.input ?? {}));
      continue;
    }
    if (part instanceof vscode.LanguageModelToolResultPart) {
      parts.push(collectToolResultText(part.content));
      continue;
    }
    if (part instanceof vscode.LanguageModelDataPart) {
      const mimeType = (part as { mimeType?: string }).mimeType ?? "";
      if (mimeType.toLowerCase() === "cache_control") {
        continue;
      }
      continue;
    }
    // Thinking parts and anything else: keep the text if there is any.
    const value = (part as { value?: unknown })?.value;
    if (typeof value === "string") {
      parts.push(value);
    } else if (Array.isArray(value)) {
      parts.push(value.join(""));
    } else {
      const thinking = (part as { thinking?: unknown })?.thinking;
      if (typeof thinking === "string") {
        parts.push(thinking);
      }
    }
  }
  return parts;
}

function collectToolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  let text = "";
  for (const part of content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      text += part.value;
      continue;
    }
    if (part instanceof vscode.LanguageModelDataPart) {
      const mimeType = (part as { mimeType?: string }).mimeType ?? "";
      if (mimeType.toLowerCase() === "cache_control") {
        continue;
      }
      text += `[data:${mimeType}]`;
      continue;
    }
    const value = (part as { value?: unknown })?.value;
    if (typeof value === "string") {
      text += value;
    }
  }
  return text;
}
