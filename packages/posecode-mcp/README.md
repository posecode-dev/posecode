# posecode-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Posecode**.
It lets a model in an MCP client learn the `.posecode` language, validate a
movement against configured range-of-motion limits, and return a link that
animates the movement as a 3D figure.

This closes the loop the playground left open: no copy-pasting a system prompt
or shuttling text between a chat window and the editor.

## Tools

| Tool | What it does |
| --- | --- |
| `posecode_authoring_guide` | Returns the Posecode authoring guide (grammar, joints, actions, example) so a capable model can draft raw `.posecode` for validation. |
| `validate_posecode` | Parses a `.posecode` document and returns errors plus any **range-of-motion clamps** (angles outside the configured rig bounds). |
| `render_posecode` | Validates, then returns a **permalink** that renders the movement in the Posecode playground. Hand it to the user to watch. |

`validate_posecode` / `render_posecode` flag invalid documents as MCP error results so
the model knows to fix and retry.

## Use from an MCP client

Run the latest published server directly from npm:

```bash
npx -y posecode-mcp@latest
```

For an MCP client that accepts JSON server configuration:

```json
{
  "mcpServers": {
    "posecode": {
      "command": "npx",
      "args": ["-y", "posecode-mcp@latest"],
      "env": { "POSECODE_BASE_URL": "https://posecode.org" }
    }
  }
}
```

`POSECODE_BASE_URL` is optional: it sets the playground that render permalinks
point at (defaults to the hosted playground).

## Local development

From the Posecode monorepo, run the TypeScript source with the workspace script:

```bash
npm start -w posecode-mcp
```

That development command uses `tsx src/stdio.ts`; MCP consumers do not need a
repository checkout, an absolute source path, or a separate `tsx` install.

## How it fits

`render_posecode` builds its links with [`posecode-share`](../posecode-share), the same
permalink primitive the playground uses, and validates with
[`posecode-parser`](../posecode-parser). The server does not render the movement
itself; 3D math runs in the user's browser when the link is opened.

## License

AGPL-3.0-only. A [separate commercial license](https://github.com/posecode-dev/posecode/blob/main/docs/legal/COMMERCIAL-LICENSE.md) is available for closed-source product use.
