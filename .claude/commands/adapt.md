---
description: Adapt this Athena agent to the assigned challenge subject
argument-hint: <challenge subject, pasted exactly as given>
---

The Athena challenge subject is:

$ARGUMENTS

The 1 hour timer is running. Read CLAUDE.md first, then do the following without asking for confirmation unless the subject is genuinely ambiguous.

1. Pick the data source. Choose a free, public, keyless API that returns real, live or recent data for this subject (prefer official sources: government agencies, Open-Meteo, USGS, NASA, World Bank, OpenAQ, etc.). Quickly verify it responds with `curl` and inspect the JSON shape. If the first choice fails, switch immediately.

2. Edit the SWAP ZONE in `server.js`:
   - `APP_NAME`, `TOOL_NAME` (snake_case verb, e.g. `explore_air_quality`), `TOOL_TITLE`.
   - `TOOL_DESCRIPTION` starting with "Use this when the user asks about...".
   - `INPUT_SCHEMA` with 2 to 4 arguments, every one with a `.default()` and `.describe()`. Include at least one argument suited to the reload buttons (time range, region, category...).
   - `fetchData()` returning the generic shape from CLAUDE.md, with a numeric `value`, a meaningful `valueName`, useful `details`, `lat`/`lon` if the data is geographic, and 3 or 4 `stats` tiles.
   - `summarize()` if the default text does not fit.

3. Edit the SWAP ZONE in `public/widget.html`: `TOOL_NAME`, `RELOAD` (argument + 3 or 4 options that make sense), `HOT_THRESHOLD`. Only touch other widget code if the subject genuinely needs it (for example, a geocoding step happens in the server, not in the widget).

4. Rewrite `AGENT_PROMPT.md` for the subject. Update `README.md` (title, data source, interactions table) briefly. No em dashes.

5. Run `bash scripts/smoke.sh` and fix anything failing. Then start the server and report the `/preview` URL to check visually.

6. Commit and push to `main` so Render redeploys.

7. Finish with a short report: data source used, tool name, 3 example prompts to type in Athena for the demo video, and a reminder to refresh the connector in Athena and paste the new AGENT_PROMPT.md.
