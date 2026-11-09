# Athena Agent: live data explorer

An Athena AI agent backed by an MCP server. It fetches real data from a public API and renders it in an interactive widget embedded in the Athena chat.

- Protocol: MCP over Streamable HTTP, endpoint `/mcp`
- Widget: `text/html+skybridge` resource driven by `window.openai`
- Data: USGS Earthquake catalog (public, no API key)

## Files

| File | What it is |
| --- | --- |
| `server.js` | MCP server: tool + widget resource + data fetching |
| `public/widget.html` | The interactive widget shown in the chat |
| `AGENT_PROMPT.md` | Text to paste in the Athena agent "prompt" field |

## Run locally

```bash
npm install
npm start
```

- Health check: http://localhost:8787/
- Raw data: http://localhost:8787/api/data?days=7
- Widget preview without Athena: http://localhost:8787/preview?days=7
- MCP endpoint: http://localhost:8787/mcp

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
```

## Widget interactions

| Control | Behaviour |
| --- | --- |
| 24h / 7d / 30d | Calls the MCP tool again via `window.openai.callTool` (real server round trip, fresh data) |
| Value slider | Filters results instantly in the widget |
| Sort | Most recent / highest value / name |
| Name filter | Text search over results |
| Click a row or map point | Expands details and highlights it on the map |

UI state is kept with `window.openai.setWidgetState`.

## Using with Claude Code

Open a terminal in this folder and run `claude`. `CLAUDE.md` briefs it on the challenge and the rules.

- `/adapt <subject>`: adapts the whole project to the assigned subject (data source, tool, widget, prompt), runs the smoke test, commits and pushes.
- `/precheck <render url>`: verifies the deployed server and prints the submission checklist.
- `bash scripts/smoke.sh [url]`: checks health, MCP handshake, tool metadata, widget mimeType and a real data call.

## Adapting to another subject

Only two places change, both marked `SWAP ZONE`:

1. `server.js`: tool name, description, `INPUT_SCHEMA`, and `fetchData()`. Return the generic shape documented above `fetchData` (`items` with `id, label, value, time, lat, lon, url, details`).
2. `public/widget.html`: `TOOL_NAME` (must match), the `RELOAD` buttons (which argument they change), and `HOT_THRESHOLD`.

If items have `lat`/`lon`, the widget draws a map. If not, it draws a bar chart automatically.

## Troubleshooting

- `window.openai` undefined: the resource mimeType must be exactly `text/html+skybridge`.
- `callTool` does nothing: the tool needs `_meta["openai/widgetAccessible"]: true` (already set).
- Widget cannot call an API directly: the iframe CSP blocks it. Always fetch in `server.js`.
- Athena shows old tools: Settings, Connectors, Refresh.
- The SDK import path is `server/streamableHttp.js` (camelCase), not `streamable-http.js`.
- Render free tier sleeps after 15 min idle. Open the health URL a minute before recording.
