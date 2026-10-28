import { MiniMaxError } from "./MiniMaxError";
import type { MiniMaxMessage } from "./types";

/**
 * How many times a request is retried with a shorter history after the API
 * reports that the prompt does not fit the context window.
 */
export const MAX_CONTEXT_RETRIES = 3;

/**
 * The error messages MiniMax and the Anthropic-compatible endpoint use when
 * the prompt is longer than the context window.
 *
 * Anthropic-style: `prompt is too long: 123456 tokens > 1000000 maximum`
 * OpenAI-style: `maximum context length exceeded` / `context_length_exceeded`
 * MiniMax: code `1039` (token limit).
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /context[ _-]?length/i,
  /maximum context/i,
  /context window/i,
  /too many tokens/i,
  /input (?:is )?too long/i,
  /reduce the length/i,
  /exceeds the context/i,
];

const CONTEXT_OVERFLOW_CODES = new Set(["1039", "context_length_exceeded"]);

/**
 * Whether the error means "the prompt does not fit the context window".
 *
 * When it does, the conversation has to shrink: the chat view normally does
 * that by compacting, but only if it noticed the prompt growing too large.
 */
export function isContextOverflowError(error: unknown): boolean {
  if (!(error instanceof MiniMaxError)) {
    return false;
  }
  if (error.statusCode === 413) {
    return true;
  }
  if (CONTEXT_OVERFLOW_CODES.has(error.code)) {
    return true;
  }
  const message = error.message ?? "";
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Drop the oldest part of the conversation so the request fits.
 *
 * Each retry keeps less history than the one before it (75%, 50%, 25% of the
 * remaining messages). Tool results whose tool call was dropped are removed
 * as well: the API rejects a history with an unmatched tool result.
 *
 * Returns `undefined` when there is nothing left to drop.
 */
export function truncateHistory(
  messages: readonly MiniMaxMessage[],
  attempt: number,
): MiniMaxMessage[] | undefined {
  if (messages.length <= 1) {
    return undefined;
  }
  const keepRatio = [0.75, 0.5, 0.25][attempt] ?? 0.25;
  const keep = Math.max(1, Math.floor(messages.length * keepRatio));
  if (keep >= messages.length) {
    return undefined;
  }
  const kept = messages.slice(messages.length - keep);
  // A leading tool result belongs to a tool call that was dropped.
  while (kept.length > 0 && kept[0].role === "tool") {
    kept.shift();
  }
  return kept.length > 0 ? kept : undefined;
}
