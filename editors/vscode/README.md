# Posecode for VS Code

Language support for the **Posecode** (`.posecode`) kinematic motion DSL:

- **Syntax highlighting** (TextMate grammar): keywords, kinds, joints, actions, easings, strings, numbers.
- **Diagnostics**: parse errors and **range-of-motion safety clamps** as you type (e.g. `knees: flex 200° → clamped to 144°`).
- **Completion** (context-aware): kinds after `posecode`, joints at line start, actions after `<joint>:`, easings in a `step` header, poses after `pose start =`, effectors after `ground-lock:`.
- **Hover**: the safe ROM range for a joint + action, and short docs for keywords.

The smart features are provided by [`posecode-lsp`](../../packages/posecode-lsp), which shares its language logic ([`posecode-language`](../../packages/posecode-language)) with the web playground, so the editor and the playground always agree.

## File association (before the extension is installed)

Until the full extension is published to the Marketplace, `.posecode` files
open as plain text. You can get basic highlighting and comment/bracket
behaviour right away by telling your editor to treat `.posecode` files as
Markdown, which is the closest built-in grammar.

### VS Code

Add the following to your `settings.json` (open the Command Palette →
**Preferences: Open User Settings (JSON)**, or use a workspace
`.vscode/settings.json` to scope it to a single project):

```json
{
  "files.associations": {
    "*.posecode": "markdown"
  }
}
```

Alternatively, open any `.posecode` file, click the language indicator in the
bottom-right status bar (it will say "Plain Text"), choose **Configure File
Association for '.posecode'…**, and pick **Markdown**.

### Cursor and other VS Code forks

Cursor, VSCodium, and other VS Code forks read the same `files.associations`
setting, so the JSON snippet above works unchanged.

### Sublime Text

Open a `.posecode` file, then use the menu **View → Syntax → Open all with
current extension as… → Markdown**.

### Neovim

Register the extension in your config:

```lua
vim.filetype.add({ extension = { posecode = "markdown" } })
```

Once the dedicated extension is installed it registers the real `posecode`
language id, and you can remove these fallbacks.

## Develop / run locally

From the repo root:

```bash
npm install
npm run build -w posecode-vscode   # compiles the client + bundles the LSP to dist/server.cjs
```

Then open this folder in VS Code and press **F5** ("Run Extension") to launch an Extension Development Host, and open any `.posecode` file.

## Package

```bash
npx @vscode/vsce package   # produces posecode-vscode-0.1.0.vsix
```
