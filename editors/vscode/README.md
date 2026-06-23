# Movit for VS Code

Language support for the **Movit** (`.movit`) kinematic motion DSL:

- **Syntax highlighting** (TextMate grammar) — keywords, kinds, joints, actions, easings, strings, numbers.
- **Diagnostics** — parse errors and **range-of-motion safety clamps** as you type (e.g. `knees: flex 200° → clamped to 144°`).
- **Completion** — context-aware: kinds after `movit`, joints at line start, actions after `<joint>:`, easings in a `step` header, poses after `pose start =`, effectors after `ground-lock:`.
- **Hover** — the safe ROM range for a joint + action, and short docs for keywords.

The smart features are provided by [`movit-lsp`](../../packages/movit-lsp), which shares its language logic ([`movit-language`](../../packages/movit-language)) with the web playground — so the editor and the playground always agree.

## Develop / run locally

From the repo root:

```bash
npm install
npm run build -w movit-vscode   # compiles the client + bundles the LSP to dist/server.cjs
```

Then open this folder in VS Code and press **F5** ("Run Extension") to launch an Extension Development Host, and open any `.movit` file.

## Package

```bash
npx @vscode/vsce package   # produces movit-vscode-0.1.0.vsix
```
