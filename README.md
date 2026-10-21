# MiniMax (Anthropic API) for VS Code

Use MiniMax models in GitHub Copilot Chat in VS Code, over the **Anthropic-compatible Messages API** — the same endpoint Claude Code, Codex and other Anthropic-compatible clients use.

Point VS Code at `https://api.minimax.io/anthropic`, paste your MiniMax Token Plan key, and pick a model.

## Why the Anthropic API?

MiniMax publishes an Anthropic-compatible endpoint next to its OpenAI-compatible one. This extension uses the Anthropic one by default, because it is the better of the two:

| | Anthropic Messages API (default) | OpenAI Chat Completions (alternative) |
|---|---|---|
| Thinking output | native `thinking` blocks, rendered as thinking parts in chat | inline `<think>` tags that have to be stripped from the text |
| Token counting | `count_tokens` endpoint, so the context estimate is the API's own number | estimated locally |
| Thinking depth | `output_config.effort` (`low` … `max`) | `reasoning_effort` (`low` … `max`) |
| Region switch | `api.minimax.io` / `api.minimaxi.com` | same |

The endpoint in use is always visible: the model picker shows `Token Plan · Anthropic API` (or `· OpenAI API`) next to every model, and `MiniMax: Select API Endpoint` switches it.

## Features

- **Anthropic-compatible by default** — `https://api.minimax.io/anthropic`, the Messages API. Switch to the OpenAI-compatible endpoint at any time.
- **Live model catalog** — the model list comes from MiniMax's own API, enriched with [models.dev](https://models.dev) for context limits, image support and reasoning levels. A model MiniMax ships shows up without an extension update; a retired one disappears.
- **Per-model reasoning effort** — models that support it get a Reasoning Effort dropdown in the model picker, with the levels MiniMax actually supports.
- **Tool calling and image input** — M3 and M3.1 Flash are multimodal and can call tools.
- **Token usage reported** per request, and the context estimate calibrated from the real usage the API returns.
- **AI-generated SCM commit messages** from your staged diff (Conventional Commits).

## Requirements

- VS Code 1.111.0+
- A MiniMax Token Plan subscription and API key ([platform.minimax.io](https://platform.minimax.io/user-center/payment/token-plan))
- VS Code Insiders is required to render MiniMax thinking blocks via the proposed `languageModelThinkingPart` API

## Setup

1. Get your Token Plan API key from [Account / Token Plan](https://platform.minimax.io/user-center/payment/token-plan)
2. In the Copilot Chat model picker, choose **Manage Language Models → MiniMax** and paste the key (the endpoint defaults to the Anthropic API)
3. Pick a MiniMax model in the model picker

Keys are stored in VS Code Secret Storage. Nothing is sent anywhere except the MiniMax endpoint you configured.

## Configuration

The endpoint and thinking mode can be set three ways:

- **Chat UI**: *Manage Language Models…* → MiniMax asks for the API key, the API endpoint (Anthropic or OpenAI) and the thinking depth.
- **Commands**: `MiniMax: Select API Endpoint (OpenAI / Anthropic SDK)`, `MiniMax: Toggle Thinking (M3)`, `MiniMax: Select Thinking Depth (M3.1 Flash)`, `MiniMax: Refresh Models`.
- **Settings**: the `minimax.*` settings below.

| Setting | Default | Description |
|---|---|---|
| `minimax.apiFormat` | `anthropic-compat` | `anthropic-compat` (default — Anthropic Messages API at `https://api.minimax.io/anthropic`) or `openai-compat` (Chat Completions at `https://api.minimax.io/v1`). |
| `minimax.anthropicBaseUrl` | `https://api.minimax.io/anthropic` | Anthropic-compatible base URL. Use `https://api.minimaxi.com/anthropic` in China. Ignored when `minimax.apiFormat` is `openai-compat`. |
| `minimax.apiBaseUrl` | `https://api.minimax.io/v1` | OpenAI-compatible base URL. Use `https://api.minimaxi.com/v1` in China. Ignored when `minimax.apiFormat` is `anthropic-compat`. |
| `minimax.thinkingEnabled` | `true` | Sends `thinking: {type: "adaptive"}` (on) or `{type: "disabled"}` (off) for M3. M2.x and M3.1 Flash always emit thinking. |
| `minimax.reasoningEffort` | `auto` | Fallback thinking depth when the model picker does not provide one: `auto`, `low`, `medium`, `high`, `xhigh`, `max`. `auto` leaves the field off the wire (endpoint default `max`). |
| `minimax.visibleModels` | all | Live model ids to show in the picker. Empty means every live model. `MiniMax-M3.1-Flash-Preview` is accepted as an alias for `MiniMax-M3.1-Flash`. |
| `minimax.commitMessageGeneration.enabled` | `true` | Show the MiniMax sparkle in the SCM commit-message input. Disable to hide the inline button without uninstalling the extension. |

`MiniMax: Switch to Global/Chinese API` updates both base URLs at once.

## Model catalog

The picker is built at runtime:

1. `GET {endpoint}/models` returns the models your account can use. The list refreshes every 30 minutes, on endpoint changes, and via `MiniMax: Refresh Models`.
2. [models.dev](https://models.dev) fills in the context window, output limit, image support and reasoning levels for those ids. A model MiniMax ships before models.dev knows it still shows up, with safe default limits, and is corrected on the next refresh.
3. If the live list cannot be fetched, the last known catalog is served from the extension's cache; if there is none, a static fallback list is used so the picker is never empty.

Models that are not chat models (speech, music, video, embeddings) are filtered out.

### Reasoning effort

Models that expose reasoning controls show a **Reasoning Effort** dropdown in the model picker, with the levels MiniMax supports (`low` … `max` for M3.1 Flash, on/off for M3). The choice is sent as `output_config.effort` on the Anthropic API and `reasoning_effort` on the OpenAI API.

M3.1 Flash always reasons — the API answers `400` for `thinking: {"type": "disabled"}` — so it never offers an "off" switch.

## Commit message generation

Generate a Conventional Commits message from your staged changes without leaving VS Code.

- **Command palette**: run `MiniMax: Generate Commit Message`.
- **Toolbar button**: a sparkle appears in the Source Control view's title bar (next to the V / refresh icons) when the Git provider is active. Click it to fill in the commit box.

> VS Code's `scm/inputBox` menu (a button *inside* the message field, like Copilot's) is still a proposed API restricted to Microsoft's own extensions, so third-party extensions can only place the button in the Source Control title toolbar.

The command reads `git diff --cached` plus `git status --short`, sends the result through `vscode.lm` to a MiniMax model, and streams the response into the SCM input box as tokens arrive.

- Defaults to `MiniMax-M3.1-Flash`. If that model isn't on your `minimax.visibleModels` list, a quick pick appears over all registered MiniMax models.
- Diffs larger than 16,000 characters are truncated before being sent, to keep token usage predictable.
- Generation runs as a Source Control progress task that can be cancelled from the progress indicator.
- The header follows Conventional Commits v1.0.0 (`<type>(<scope>): <description>`), lowercase, imperative mood, ≤ 72 chars. Use the bullet section only when the header alone can't capture the scope.
- Set `minimax.commitMessageGeneration.enabled: false` to hide the toolbar sparkle without uninstalling the extension.

> Requires a MiniMax API key already configured in the Copilot model picker (the command uses the same `vscode.lm` provider the extension exposes).

## Models

The picker shows the models your account can use (live list). The table below is the static fallback used when the live list cannot be fetched.

| Model | Context | Max input | Max output |
|--------|---------|-----------|-----------|
| MiniMax-M3.1-Flash | 1,000,000 | 1,000,000 | 131,072 |
| MiniMax-M3 | 1,000,000 | 1,000,000 | 131,072 |
| MiniMax-M2.7 | 204,800 | 200,000 | 131,072 |
| MiniMax-M2.7-highspeed | 204,800 | 200,000 | 131,072 |
| MiniMax-M2.5 | 204,800 | 196,000 | 128,000 |
| MiniMax-M2.5-highspeed | 204,800 | 196,000 | 128,000 |
| MiniMax-M2.1 | 204,800 | 196,000 | 128,000 |
| MiniMax-M2.1-highspeed | 204,800 | 196,000 | 128,000 |
| MiniMax-M2 | 204,800 | 192,000 | 128,000 |

### MiniMax M3.1 Flash

`MiniMax-M3.1-Flash` is the generally available successor to `MiniMax-M3.1-Flash-Preview` (rolled out October 19, 2026). The preview id is still accepted as an alias in `minimax.visibleModels`.

- It always reasons — the API rejects `thinking: {"type": "disabled"}` with HTTP 400 — so the extension never sends "off" for it.
- Thinking depth is tunable from the model picker (`low` … `max`), sent as `output_config.effort` on the Anthropic API and `reasoning_effort` on the OpenAI API. `auto` leaves the field off the wire, so the endpoint default (`max`) applies.
- It supports image input, like M3.

> MiniMax is retiring the M2.5 / M2.7 families on November 18, 2026 (M2.1 and M2 are already retired). Token Plan requests to the M2.5 / M2.7 names are routed to M3.1 Flash until then.

## Troubleshooting

**The model picker is empty.** The catalog comes from the API, so it needs network access and a valid key. Check *Output → MiniMax* for the reason. If the endpoint is unreachable, the extension falls back to a static model list.

**`400` errors mentioning `thinking`.** M3.1 Flash cannot run without reasoning. The extension never sends `thinking: disabled` for it; if you see this, the request came from a different client.

**The context indicator looks off.** The input budget is the context window minus the output reservation (the Copilot BYOK convention), and the token estimate is calibrated from the real usage the API returns.

## Relationship to the original extension

This is an independent build of the MiniMax VS Code provider. It adds the Anthropic-compatible endpoint as the default, the live model catalog, the SCM commit-message generator, and per-model reasoning effort. The original lives at [zelosleone/minimax-vscode](https://github.com/zelosleone/minimax-vscode) and is published on the Marketplace as **MiniMax (coding)** — this one is the Anthropic-API-focused variant, so you can pick whichever endpoint story you prefer.

## Privacy

The extension talks only to the MiniMax endpoint you configure, using the API key you provide. The key is stored in VS Code Secret Storage and is never sent anywhere else. No telemetry is collected.

## License

MIT
