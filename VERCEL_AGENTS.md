# Vercel Plugin — AI Agent Instructions

> Drop this file into any GitHub repo. AI coding agents (Claude Code, Codex, Cursor, Copilot, Grok Build) will pick it up automatically.

## Setup (one-time per machine)

```bash
npx plugins add vercel/vercel-plugin
```

Requires Node.js 18+ and Bun. After install, session context is injected automatically for Vercel/Next.js projects.

## Slash commands

| Command | Purpose |
|---|---|
| `/vercel-plugin:bootstrap` | Link project, provision env vars, set up DB |
| `/vercel-plugin:deploy` | Deploy preview; pass `prod` for production |
| `/vercel-plugin:env` | List, pull, add, remove, diff env vars |
| `/vercel-plugin:status` | Recent deployments and environment overview |
| `/vercel-plugin:marketplace` | Discover and install Marketplace integrations |

## Key skills (invoke on demand)

- `nextjs` — App Router, Server Components, Server Actions, rendering strategies
- `ai-sdk` — AI SDK v6: streaming, tool calling, agents, MCP, embeddings
- `ai-gateway` — Unified API to 100+ models with failover and cost tracking
- `vercel-functions` — Serverless, Edge, Fluid Compute, streaming, Cron Jobs
- `vercel-storage` — Blob, Edge Config, Neon Postgres, Upstash Redis
- `deployments-cicd` — Deploy, promote, rollback, `--prebuilt`, CI config
- `env-vars` — `.env` files, `vercel env`, OIDC tokens
- `routing-middleware` — Rewrites, redirects, personalization (Node.js/Edge/Bun)
- `runtime-cache` — Per-region KV cache with tag-based invalidation
- `shadcn` — shadcn/ui CLI, components, theming, Tailwind integration
- `workflow` — Durable execution, DurableAgent, steps, pause/resume
- `vercel-sandbox` — Ephemeral VMs for running untrusted/AI-generated code
- `verification` — Browser, API, data, and response flow verification

## Specialist agents

- `deployment-expert` — CI/CD, deploy strategies, environment variables, rollbacks
- `performance-optimizer` — Core Web Vitals, caching, rendering, asset optimization
- `ai-architect` — AI app design, model selection, streaming, MCP integration

## Platform defaults to assume

- Framework: Next.js App Router
- Compute: Fluid Compute (not legacy Edge Functions)
- Node.js: 24 LTS (18 is deprecated)
- Function timeout: 300s default
- AI SDK: v6 with `"provider/model"` strings via AI Gateway
- Config: `vercel.ts` preferred over `vercel.json`
- Databases: Via Vercel Marketplace (Vercel Postgres/KV are retired)

## Telemetry

```bash
export VERCEL_PLUGIN_TELEMETRY=off   # disable
export VERCEL_PLUGIN_LOG_LEVEL=debug # enable debug logs
```

```bash
npx vercel-plugin doctor  # validate plugin health
```

## Issues

File bugs at <https://github.com/vercel/vercel-plugin/issues> with debug logs enabled.
