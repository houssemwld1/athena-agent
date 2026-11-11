#!/usr/bin/env bash
# Smoke test for the Athena MCP server.
# Usage: bash scripts/smoke.sh                      (starts a local server on 8787)
#        bash scripts/smoke.sh https://x.onrender.com   (tests a deployed server)
set -u

BASE="${1:-}"
STARTED=""
if [ -z "$BASE" ]; then
  BASE="http://localhost:8787"
  if ! curl -s -m 2 "$BASE/" >/dev/null 2>&1; then
    PORT=8787 node server.js >/tmp/athena-smoke.log 2>&1 &
    STARTED=$!
    for _ in $(seq 1 30); do curl -s -m 1 "$BASE/" >/dev/null 2>&1 && break; sleep 0.3; done
  fi
fi
BASE="${BASE%/}"; BASE="${BASE%/mcp}"

pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "        $2"; fail=$((fail+1)); }
rpc() { curl -s -m 60 -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' "$BASE/mcp" -d "$1"; }

echo "Testing $BASE"

H=$(curl -s -m 60 "$BASE/")
[[ "$H" == *"OK"* ]] && ok "health" || bad "health" "$H"

I=$(rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}')
[[ "$I" == *'"serverInfo"'* ]] && ok "initialize" || bad "initialize" "${I:0:300}"

T=$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
TOOL=$(node -e 'try{const r=JSON.parse(process.argv[1]);process.stdout.write(r.result.tools[0].name)}catch(e){}' "$T")
[ -n "$TOOL" ] && ok "tools/list -> $TOOL" || bad "tools/list" "${T:0:300}"
[[ "$T" == *'openai/outputTemplate'* ]] && ok "outputTemplate set" || bad "outputTemplate missing"
[[ "$T" == *'"openai/widgetAccessible":true'* ]] && ok "widgetAccessible true" || bad "widgetAccessible missing"

WURI=$(node -e 'try{const r=JSON.parse(process.argv[1]);process.stdout.write(r.result.tools[0]._meta["openai/outputTemplate"])}catch(e){}' "$T")
R=$(rpc "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"resources/read\",\"params\":{\"uri\":\"${WURI:-ui://widget/explorer.html}\"}}")
[[ "$R" == *'"mimeType":"text/html+skybridge"'* ]] && ok "widget mimeType text/html+skybridge" || bad "widget resource" "${R:0:300}"

WTOOL=$(grep -oE 'const TOOL_NAME = "[^"]+"' public/widget.html 2>/dev/null | cut -d'"' -f2)
if [ -n "$WTOOL" ] && [ -n "$TOOL" ]; then
  [ "$WTOOL" = "$TOOL" ] && ok "widget TOOL_NAME matches" || bad "widget TOOL_NAME ($WTOOL) != server ($TOOL)"
fi

if [ -n "$TOOL" ]; then
  C=$(rpc "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":{}}}")
  SUMMARY=$(node -e '
    try {
      const r = JSON.parse(process.argv[1]).result;
      if (r.isError) { console.log("ERR " + r.content?.[0]?.text); process.exit(); }
      const s = r.structuredContent || {};
      const items = s.items || [];
      const nums = items.filter(i => typeof i.value === "number").length;
      console.log(`items=${items.length} numericValues=${nums} title=${s.title} first=${JSON.stringify(items[0]||{}).slice(0,160)}`);
    } catch (e) { console.log("ERR unparseable"); }' "$C")
  if [[ "$SUMMARY" == ERR* ]]; then bad "tools/call (real data)" "$SUMMARY"
  elif [[ "$SUMMARY" == items=0* ]]; then bad "tools/call returned 0 items" "$SUMMARY"
  else ok "tools/call real data"; echo "        $SUMMARY"; fi
fi

[ -n "$STARTED" ] && kill "$STARTED" 2>/dev/null
echo "Result: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
