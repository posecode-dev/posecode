# posecode-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Posecode**.
It gives any MCP-capable agent (Claude Desktop, Cursor, …) a native way to *show
movement*: learn the `.posecode` language, validate a movement against healthy
range-of-motion limits, and get a link that animates it as a 3D figure.

This closes the loop the playground left open: no copy-pasting a system prompt
or shuttling text between a chat window and the editor.

## Tools

| Tool | What it does |
| --- | --- |
| `posecode_authoring_guide` | Returns the Posecode authoring guide (grammar, joints, actions, example) so the model can write valid `.posecode`. |
| `validate_posecode` | Parses a `.posecode` document and returns errors plus any **range-of-motion safety clamps** (the angles that were out of healthy range). |
| `render_posecode` | Validates, then returns a **permalink** that renders the movement in the Posecode playground. Hand it to the user to watch. |

`validate_posecode` / `render_posecode` flag invalid documents as MCP error results so
the model knows to fix and retry.

## Run

It's a TypeScript server; run it with [`tsx`](https://github.com/privatenumber/tsx)
(no build step needed):

```bash
npm start -w posecode-mcp          # tsx src/stdio.ts
```

### Add to Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "posecode": {
      "command": "npx",
      "args": ["-y", "tsx", "/ABSOLUTE/PATH/TO/posecode/packages/posecode-mcp/src/stdio.ts"],
      "env": { "POSECODE_BASE_URL": "https://posecode.org" }
    }
  }
}
```

`POSECODE_BASE_URL` is optional: it sets the playground that render permalinks
point at (defaults to the hosted playground).

## How it fits

`render_posecode` builds its links with [`posecode-share`](../posecode-share), the same
permalink primitive the playground uses, and validates with
[`posecode-parser`](../posecode-parser). The server holds no rendering itself; 3D math
runs client-side when the link is opened.
