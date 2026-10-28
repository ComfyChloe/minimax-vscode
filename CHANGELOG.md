# Changelog

## 1.8.1 — Context window and compaction

- The token count the extension reports is no longer allowed to be too low, because that is what makes the chat view skip compaction and the request fail with a context-window error:
  - images are counted with the same tile formula the chat view uses, instead of being counted as free once their base64 payload is stripped,
  - the estimate is scaled up by a safety margin (`minimax.contextSafetyMargin`, 15% by default),
  - the learned characters-per-token ratio is clamped, so one odd response cannot skew it.
- A request that still comes back with a context-window error is retried with the oldest part of the conversation dropped (up to three times) instead of failing the turn. Tool results whose tool call was dropped are removed as well, so the API does not reject the history.
- The reported usage now includes the cached-token breakdown the chat view expects, and the Anthropic path reports the cache-read tokens.

## 1.8.0 — Published as `ComfyChloe.minimax-anthropic`

- The extension is now published under its own Marketplace identity, `ComfyChloe.minimax-anthropic` ("MiniMax (Anthropic API)"), by [ComfyChloe](https://github.com/ComfyChloe). The upstream listing `DenizhanDaklr.minimax-vscode` is untouched.
- The model provider now registers the vendor id `minimax-anthropic` and the commands are namespaced `minimaxAnthropic.*`, so this extension and the original can be installed side by side without clashing in the model picker or the command palette.
- README documents the new identity, the command ids, and how this build differs from the original.

## 1.7.0 — Anthropic-first

- The Anthropic-compatible Messages API (`https://api.minimax.io/anthropic`) is now the default endpoint. The OpenAI-compatible Chat Completions API stays available as an alternative, and the active endpoint is shown next to every model in the picker.
- The live model catalog is read from the endpoint in use: `{anthropicBaseUrl}/v1/models` for the Anthropic API, `{apiBaseUrl}/models` for the OpenAI one.
- The API key is sent as `X-Api-Key` as well as `Authorization: Bearer`, so both endpoints accept it.
- README rewritten for the Anthropic API path, with an endpoint comparison table.

## 1.6.0 — Live model catalog

- The model picker is built at runtime from MiniMax's own `/models` endpoint, enriched with [models.dev](https://models.dev) for context limits, image support and reasoning levels. New models appear without an extension update; retired ones disappear.
- The catalog refreshes every 30 minutes, on endpoint changes, and via the new `MiniMax: Refresh Models` command. It is cached per endpoint + account, with a static fallback so the picker is never empty.
- Models that expose reasoning controls get a Reasoning Effort dropdown in the model picker, with the levels MiniMax documents.
- Token usage is reported per request, and the context estimate is calibrated from the real usage the API returns.
- BYOK token limits (input budget = context − output reservation) and `isBYOK` on the model entries.
- The inline-thinking parser now handles reasoning that starts without a `<think>` tag, so its closing tag cannot leak into the answer.
- Added a test suite covering the catalog, the cache scoping and the picker schema.

## 1.5.9 — MiniMax M3.1 Flash (generally available)

- Switched the model catalog to `MiniMax-M3.1-Flash`, the generally available successor to `MiniMax-M3.1-Flash-Preview` (rolled out October 19, 2026). The preview id is kept as an alias.
- Added thinking depth control for M3.1 Flash (`minimax.reasoningEffort` and the `MiniMax: Select Thinking Depth` command), sent as `output_config.effort` (Anthropic) or `reasoning_effort` (OpenAI).
- M3.1 Flash keeps adaptive thinking on even when the thinking mode is off — the API answers `400` for `thinking: {"type": "disabled"}` on that model.

## 1.5.8 — MiniMax M3.1 Flash Preview

- Added `MiniMax-M3.1-Flash-Preview` to the model picker, with tool calling and image input.

## 1.5.3 — SCM commit messages

- Added AI-generated Conventional Commit messages from the staged diff, via a sparkle button in the Source Control view's title bar.

## 1.5.2 — Anthropic SDK

- Added the Anthropic-compatible Messages API as an alternative to the OpenAI-compatible Chat Completions API, with native thinking blocks and the `count_tokens` endpoint.
