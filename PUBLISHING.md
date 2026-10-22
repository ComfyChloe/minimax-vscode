# Publishing to the VS Code Marketplace

This extension is published to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/) as a
BYOK language-model provider. This file is the runbook.

## 1. The extension identity

The Marketplace identity is `publisher.name` from `package.json`, and it is **immutable once published**:
the name is reserved forever, even if the extension is later removed.

| Field | Current value | Notes |
|---|---|---|
| `publisher` | `ComfyChloe` | Must be a publisher **you control**. The upstream project owns `DenizhanDaklr`, so this build uses your own publisher. |
| `name` | `minimax-anthropic` | Must be unique across the Marketplace. `minimax-vscode` is taken by the upstream listing, so this build uses `minimax-anthropic`. |
| `displayName` | `MiniMax (Anthropic API)` | Also unique across the Marketplace. |

The identity is already set to a free, Anthropic-focused listing:

```
ComfyChloe.minimax-anthropic   →  https://marketplace.visualstudio.com/items?itemName=ComfyChloe.minimax-anthropic
```

Two ways to list it:

- **A separate listing** (what this build is set up for): `ComfyChloe.minimax-anthropic`. The upstream listing
  stays as it is, and users can install either — or both, since this build registers its own model vendor id
  (`minimax-anthropic`) and its own command ids (`minimaxAnthropic.*`).
- **The same listing**: `DenizhanDaklr.minimax-vscode`. Publishing then creates a new *version* of the existing
  listing, and the upstream publisher's next release overwrites yours. Only do this with the publisher owner's
  agreement — it also needs their Azure DevOps PAT, not yours.

> If your Microsoft account is not `ComfyChloe`, create a publisher with the right ID (step 2) and change
> `publisher` in `package.json` **before** the first publish — the ID cannot be changed afterwards.

## 2. Create the publisher (once)

1. Sign in to <https://marketplace.visualstudio.com/manage> with your Microsoft account.
2. **Create publisher** in the left pane: pick an **ID** (lowercase, unique, permanent) and a **Name**.
3. Note the ID — it goes into `package.json` as `publisher`.

## 3. Get a Personal Access Token (once)

The Marketplace is backed by Azure DevOps, so `vsce` authenticates with an Azure DevOps PAT:

1. Go to <https://dev.azure.com> → your profile → **Personal access tokens** → **+ New token**.
2. **Organization**: *All accessible organizations*.
3. **Scopes**: *Show all scopes* → **Marketplace** → **Manage**.
4. Copy the token (it is shown only once).

> **Heads-up:** global Azure DevOps PATs are retired on **December 1, 2026**. A PAT still works until then, but
> the long-term path is Microsoft Entra ID with workload identity federation and
> `vsce publish --azure-credential` (see the VS Code docs, *Publishing Extensions* → *Secure automated
> publishing*).

Save it in your environment for the current shell (it is not stored in the repo):

```powershell
$env:VSCE_PAT = "<your-token>"
```

or store it in the OS keychain once with `npx vsce login <publisher-id>`.

## 4. Publish

```powershell
npm install          # dev dependencies, including @vscode/vsce
npm run compile      # tsc --noEmit
npm test             # catalog / picker tests
npm run publish      # vsce publish (runs the bundle via vscode:prepublish)
```

`vsce publish` bumps nothing by itself: the version in `package.json` must be **higher** than the highest
version already published for that extension id. `vsce publish 1.8.1` would set the version and publish in one
go.

Prefer to review first:

```powershell
npm run package                  # produces minimax-vscode-<version>.vsix
code --install-extension minimax-vscode-<version>.vsix
```

You can also upload the VSIX by hand at
<https://marketplace.visualstudio.com/manage> → your publisher → **Add extension** → **Upload**.

## 5. Check the listing

The page appears at:

```
https://marketplace.visualstudio.com/items?itemName=<publisher>.<name>
```

It can take a few minutes to show up after the first publish. The README, the changelog and the support page
from the repository are rendered on that page, so keep them useful.

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `ERROR The extension 'name' already exists in the Marketplace` | The name is taken. Pick a different `name` in `package.json`. |
| `403 Forbidden` / `401 Unauthorized` | The PAT is missing the *Marketplace → Manage* scope, or was created for a single organization instead of *All accessible organizations*. |
| `The Personal Access Token verification has failed` | The token is expired or belongs to a different publisher. Create a new one and run `vsce login <publisher-id>`. |
| `A publisher with the given name already exists` / `does not exist` | Create the publisher at <https://marketplace.visualstudio.com/manage> first, or fix the `publisher` field. |
| Version rejected | The version must be higher than the latest published one for that extension id. |
