# Athena AI interview challenge: project brief

This repo is a working Athena AI agent: an MCP server (Node, `server.js`) that fetches real public data and serves an interactive widget (`public/widget.html`) rendered inside the Athena chat. It is a generic starter. During the challenge it gets adapted to an assigned subject within a strict 1 hour limit.

## The challenge (what is graded)

The submission must show, in a video under 1 minute recorded inside Athena:
1. The solution works.
2. The agent retrieves REAL data from an open/public source relevant to the subject.
3. The widget renders that data.
4. The widget is interactive.
5. The widget is embedded and rendered within Athena.

Deliverables: .mp4/.MOV video, MCP URL (Render, ends in `/mcp`), Athena agent link, GitHub repo link.

## Time rules for you (Claude Code)

- Speed beats polish. Make the smallest change that fully satisfies the subject.
- Only edit the two `SWAP ZONE` sections unless something is truly broken. Everything below the SWAP ZONE in `server.js` is proven to work with Athena; do not refactor it.
- Never add a build step, bundler, framework or TypeScript. Plain Node ESM + one vanilla HTML file.
- Never add dependencies unless unavoidable. Node 18+ has global `fetch`.
- Prefer public APIs with NO API key and no signup. If a key is unavoidable, read it from `process.env` and tell the user to set it on Render.
- After every change run `bash scripts/smoke.sh` and fix failures before reporting done.
- No em dashes in any text, docs or UI copy.

## Architecture (do not break these contracts)

- MCP over Streamable HTTP, stateless, at `/mcp`. Import path is `@modelcontextprotocol/sdk/server/streamableHttp.js` (camelCase; the Athena docs are wrong about this).
- Widget resource URI `ui://widget/explorer.html`, mimeType exactly `text/html+skybridge`. Any other mimeType means `window.openai` is undefined.
- Tool `_meta` must keep `openai/outputTemplate` pointing to the widget URI and `openai/widgetAccessible: true` (needed for `callTool` from the widget).
- Tool result: `content` (short text summary for the model) + `structuredContent` (the data the widget renders). Keep `structuredContent` reasonably small (cap items, around 150 to 300).
- The widget iframe has a strict CSP: it must NEVER call external APIs or load external scripts, fonts or images. All data fetching happens in `server.js`. All CSS/JS stays inline.
- Widget reads data from `window.openai.toolOutput`, listens for `openai:set_globals`, re-fetches via `window.openai.callTool(TOOL_NAME, args)`, persists UI state with `window.openai.setWidgetState`.

## Generic data shape returned by `fetchData()`

```js
{
  title, subtitle, source, sourceUrl,
  query: { ...args actually used },      // widget re-sends these on reload
  valueName: "Magnitude",                // what item.value means, shown in UI
  items: [{ id, label, value, time, lat, lon, url, details: { "Key": value } }],
  stats: [{ label, value }]               // 2 to 4 summary tiles
}
```

- `value` must be a number (drives slider, sort, badge color, bar length, dot size).
- `lat`/`lon` optional. If present the widget draws a world map, otherwise a bar chart.
- `time` optional ISO string. `details` is free-form key/value shown when a row is expanded.

## Widget SWAP ZONE knobs (`public/widget.html`)

- `TOOL_NAME`: must equal `TOOL_NAME` in `server.js`.
- `RELOAD`: which tool argument the segmented buttons change and its options. These buttons trigger a real MCP round trip, which proves live data on video. Keep this.
- `HOT_THRESHOLD`: values at or above get a red badge/dot. Pick something meaningful for the subject.

## Local testing

- `npm start` then open http://localhost:8787/preview?ARG=VALUE to see the widget with a mocked `window.openai` and real data.
- `http://localhost:8787/api/data?ARG=VALUE` returns the raw JSON.
- `bash scripts/smoke.sh` checks health, initialize, tools/list, resources/read (mimeType) and a real tools/call.

## Deploy and Athena

- Deployed on Render from GitHub: build `npm install`, start `npm start`. Pushing to `main` redeploys.
- MCP URL = Render URL + `/mcp`. After changing tools, the user must refresh the connector in Athena.
- `AGENT_PROMPT.md` is pasted into the Athena agent prompt field. Update it for the subject: tell the agent to ALWAYS call the tool for this topic, map natural language to arguments, then reply in 2 or 3 sentences without repeating the widget content.
