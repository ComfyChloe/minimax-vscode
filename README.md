# MiniMax (coding) for VS Code

Language model chat provider for GitHub Copilot in VS Code using MiniMax text models with a Token Plan API key.

## Features

- Token Plan API key from [platform.minimax.io](https://platform.minimax.io)
- Live model catalog: the model list comes from MiniMax's own `/models` endpoint, enriched with [models.dev](https://models.dev) for context limits, image support and reasoning levels — new models show up without an update
- OpenAI-compatible chat to `https://api.minimax.io/v1`, or the Anthropic-compatible Messages API at `https://api.minimax.io/anthropic`
- Tool calling and reasoning/thinking streaming, with per-model reasoning-effort levels in the model picker
- M3 and M3.1 Flash models support image input (multimodal)
- Token usage reported per request, and the context estimate calibrated from real usage
- AI-generated SCM commit messages from your staged diff (Conventional Commits)

## Requirements

- VS Code 1.111.0+
- MiniMax Token Plan subscription and API key
- VS Code Insiders is required to render MiniMax thinking blocks via the proposed `languageModelThinkingPart` API

## Setup

1. Get your Token Plan API key from [Account / Token Plan](https://platform.minimax.io/user-center/payment/token-plan)
2. Use the API key navigation action in the model picker
3. Choose a model in the Copilot model picker

Keys are stored in VS Code Secret Storage.

## Configuration

The API endpoint (SDK) and thinking mode can be set three ways:

- **Chat UI**: in the Copilot model picker, choose *Manage Language Models…* → MiniMax; the flow asks for the API key, the API endpoint (OpenAI or Anthropic SDK), and the thinking toggle.
- **Commands**: `MiniMax: Select API Endpoint (OpenAI / Anthropic SDK)`, `MiniMax: Toggle Thinking (M3)` and `MiniMax: Select Thinking Depth (M3.1 Flash)`. Every change shows a confirmation message.
- **Settings**: the `minimax.*` settings below.

The model picker shows which SDK is active (e.g. `Token Plan · Anthropic SDK`).

| Setting | Default | Description |
|---|---|---|
| `minimax.apiFormat` | `openai-compat` | API protocol: `openai-compat` (default) or `anthropic-compat` (recommended per MiniMax docs; enables `count_tokens` and native thinking blocks). |
| `minimax.apiBaseUrl` | `https://api.minimax.io/v1` | OpenAI-compatible base URL. Use `https://api.minimaxi.com/v1` for users in China. |
| `minimax.anthropicBaseUrl` | `https://api.minimax.io/anthropic` | Anthropic-compatible base URL. Use `https://api.minimaxi.com/anthropic` for users in China. Ignored when `apiFormat` is `openai-compat`. |
| `minimax.thinkingEnabled` | `true` | Sends `thinking: {type: "adaptive"}` (on) or `{type: "disabled"}` (off) for M3. M2.x and M3.1 Flash always emit thinking. |
| `minimax.reasoningEffort` | `auto` | Fallback thinking depth when the model picker does not provide one: `auto`, `low`, `medium`, `high`, `xhigh`, `max`. `auto` leaves the field off the wire (endpoint default `max`). |
| `minimax.visibleModels` | all | Live model ids to show in the picker. Empty means every live model. `MiniMax-M3.1-Flash-Preview` is accepted as an alias for `MiniMax-M3.1-Flash`. |
| `minimax.commitMessageGeneration.enabled` | `true` | Show the MiniMax sparkle on the SCM commit-message input. Disable to hide the inline button without uninstalling the extension. |

The `MiniMax: Switch to Global/Chinese API` commands update both the OpenAI and Anthropic base URLs.

## Model catalog

The picker is built at runtime:

1. `GET {minimax.apiBaseUrl}/models` returns the models the account can use. The list is refreshed every 30 minutes, on endpoint changes, and via the `MiniMax: Refresh Models` command.
2. [models.dev](https://models.dev) fills in the context window, output limit, image support and reasoning levels for those ids. A model MiniMax ships before models.dev knows it still shows up, with safe default limits, and is corrected on the next refresh.
3. If the live list cannot be fetched, the last known catalog is served from the extension's cache; if there is none, a static fallback list is used so the picker is never empty.

Models that are not chat models (speech, music, video, embeddings) are filtered out. `minimax.visibleModels` pins the list: leave it empty to show every live model.

### Reasoning effort

Models that expose reasoning controls show a **Reasoning Effort** dropdown in the model picker, with the levels MiniMax actually supports (`low` … `max` for M3.1 Flash, on/off for M3). The choice is sent as `output_config.effort` on the Anthropic SDK path and `reasoning_effort` on the OpenAI SDK path.

M3.1 Flash always reasons — the API answers `400` for `thinking: {"type": "disabled"}` — so it never offers an "off" switch.

## Commit message generation

Generate a Conventional Commits message from your staged changes without leaving VS Code.

- **Command palette**: run `MiniMax: Generate Commit Message`.
- **Toolbar button**: a sparkle appears in the Source Control view's title bar (next to the ✓ / refresh icons) when the Git provider is active. Click it to fill in the commit box.

> VS Code's `scm/inputBox` menu (a button *inside* the message field, like Copilot's) is still a proposed API restricted to Microsoft's own extensions, so third-party extensions can only place the button in the Source Control title toolbar.

The command reads `git diff --cached` plus `git status --short`, sends the result through `vscode.lm` to a MiniMax model, and streams the response into the SCM input box as tokens arrive.

- Defaults to `MiniMax-M3.1-Flash`. If that model isn't on your `minimax.visibleModels` list, a quick pick appears over all registered MiniMax models.
- Diffs larger than 16,000 characters are truncated before being sent, to keep token usage predictable.
- Generation runs as a Source Control progress task that can be cancelled from the progress indicator.
- The header follows Conventional Commits v1.0.0 (`<type>(<scope>): <description>`), lowercase, imperative mood, ≤ 72 chars. Use the bullet section only when the header alone can't capture the scope.
- Set `minimax.commitMessageGeneration.enabled: false` to hide the toolbar sparkle without uninstalling the extension.

> Requires a MiniMax API key already configured in the Copilot model picker (the command uses the same `vscode.lm` provider the extension exposes).

## Models

The picker shows the models your account can use (live list). The table below
is the static fallback used when the live list cannot be fetched.

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
- Thinking depth is tunable from the model picker (`low` … `max`), sent as `output_config.effort` on the Anthropic SDK path and `reasoning_effort` on the OpenAI SDK path. `auto` leaves the field off the wire, so the endpoint default (`max`) applies.
- It supports image input, like M3.

> MiniMax is retiring the M2.5 / M2.7 families on November 18, 2026 (M2.1 and M2 are already retired). Token Plan requests to the M2.5 / M2.7 names are routed to M3.1 Flash until then.

## License

MIT
