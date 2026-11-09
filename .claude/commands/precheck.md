---
description: Verify the deployed Athena agent before recording the demo
argument-hint: <deployed base URL, e.g. https://my-app.onrender.com>
---

Deployed base URL: $ARGUMENTS

1. Run `bash scripts/smoke.sh $ARGUMENTS` (this also wakes a sleeping Render instance; retry once if the first call times out).
2. Confirm: the tool is listed with `openai/outputTemplate` and `openai/widgetAccessible`, the resource mimeType is `text/html+skybridge`, and `tools/call` returns non-empty `structuredContent.items` with real values.
3. Print the final submission checklist with the actual values filled in:
   - MCP URL: $ARGUMENTS/mcp
   - Repo link: from `git remote get-url origin`
   - Athena agent link: (user fills in)
   - Video: under 1 minute, .mp4 or .MOV, uploaded directly. Must show the question typed in Athena, the widget appearing with real data, a reload button click (live refetch), slider/sort/detail interactions.
4. Give 3 demo prompts to type, best first.
