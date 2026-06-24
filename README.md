# my-agent

A durable backend AI agent built with the [eve](https://github.com/vercel/eve) framework.

eve is filesystem-first: the agent is just a directory on disk. Instructions,
tools, skills, and channels are all plain files that eve compiles and runs.

## Requirements

- Node.js 24.x

## Setup

```bash
npm install
```

Create a `.env.local` for any secrets the agent needs (model provider keys,
auth credentials, etc.). It is git-ignored.

## Development

```bash
npm run dev        # run the agent locally with the eve dev server / REPL
npm run typecheck  # type-check with tsc
npm run build      # compile the agent (eve build)
npm run start      # run the compiled agent (eve start)
```

## Project structure

```
agent/
  agent.ts            # Agent definition (model selection)
  instructions.md     # System prompt / behavior
  channels/
    eve.ts            # Channel + auth configuration
  tools/
    get_weather.ts    # Example tool: current weather for a city
    search_person.ts  # Aggregates public info (Wikipedia, DuckDuckGo) + leads
  skills/
    eve/SKILL.md      # Bundled eve framework skill
```

The agent currently runs on the `google/gemini-2.5-flash` model (see
`agent/agent.ts`).

## Tools

| Tool | Description |
| --- | --- |
| `get_weather` | Returns the current weather for a given city. |
| `search_person` | Looks up publicly available information about a person from free public sources (Wikipedia, DuckDuckGo) and returns a biographical overview plus categorized follow-up search leads. Surfaces only already-public information. |

Tools are defined as files under `agent/tools/`; the model sees each tool by its
filename. Add a new tool by dropping in another `defineTool` file.

## Documentation

The complete, version-matched eve documentation ships inside the package:

```
node_modules/eve/docs/   # start with README.md
```

Always read the relevant guide there before writing or editing eve code.

## Deployment

This project is configured for Vercel (see `.vercelignore` and the `vercelOidc`
auth provider in `agent/channels/eve.ts`). The `placeholderAuth` in that file
does **not** allow browser requests in production — replace it with a real auth
provider (Auth.js, Clerk, …) or `none()` for a public demo before deploying.
