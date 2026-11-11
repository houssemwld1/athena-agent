// Athena starter: MCP server + interactive widget.
// During the challenge you only edit the section marked "SWAP ZONE".

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
globalThis.crypto ??= webcrypto; // Node 18 has no global crypto; the MCP SDK needs it
import { z } from "zod";

const WIDGET_HTML = readFileSync(new URL("./public/widget.html", import.meta.url), "utf8");
// Content hash in the URI: Athena caches widget HTML by URI, so every widget change gets a fresh URI.
const WIDGET_VERSION = createHash("sha1").update(WIDGET_HTML).digest("hex").slice(0, 8);
const WIDGET_URI = `ui://widget/explorer-${WIDGET_VERSION}.html`;
const APPS_URI = `ui://widget/explorer-app-${WIDGET_VERSION}.html`; // same widget, MCP Apps standard mimeType

// =====================================================================
// SWAP ZONE: change these for the subject you get
// =====================================================================

const APP_NAME = "earthquake-explorer";
const TOOL_NAME = "search_earthquakes";
const TOOL_TITLE = "Search earthquakes";
const TOOL_DESCRIPTION =
  "Use this when the user asks about recent earthquakes or seismic activity. " +
  "Fetches live data from the USGS public earthquake catalog and shows an interactive explorer widget.";

// Inputs the model (and the widget) can pass. Keep defaults so every arg is optional.
const INPUT_SCHEMA = {
  days: z.number().int().min(1).max(30).default(7).describe("How many days back to search (1-30)"),
  min_magnitude: z.number().min(0).max(10).default(4.5).describe("Minimum magnitude"),
  limit: z.number().int().min(1).max(300).default(150).describe("Max number of results"),
};

// Fetch real data and return it in the generic shape the widget understands:
// {
//   title, subtitle, source, sourceUrl,
//   query: {...the args used...},
//   valueName: "Magnitude",           // what "value" means
//   items: [{ id, label, value, time, lat, lon, url, details: { key: value } }],
//   stats: [{ label, value }]
// }
async function fetchData(args) {
  const days = args.days ?? 7;
  const minMag = args.min_magnitude ?? 4.5;
  const limit = args.limit ?? 150;

  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    `&starttime=${start}&minmagnitude=${minMag}&orderby=time&limit=${limit}`;

  const res = await fetch(url, { headers: { "User-Agent": "athena-starter" } });
  if (!res.ok) throw new Error(`USGS returned ${res.status}`);
  const json = await res.json();

  const items = json.features.map((f) => ({
    id: f.id,
    label: f.properties.place || "Unknown location",
    value: f.properties.mag,
    time: new Date(f.properties.time).toISOString(),
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    url: f.properties.url,
    details: {
      "Depth (km)": f.geometry.coordinates[2]?.toFixed(1),
      "Magnitude type": f.properties.magType,
      "Felt reports": f.properties.felt ?? 0,
      "Tsunami flag": f.properties.tsunami ? "Yes" : "No",
      Significance: f.properties.sig,
    },
  }));

  const values = items.map((i) => i.value).filter((v) => typeof v === "number");
  const max = values.length ? Math.max(...values) : null;

  return {
    title: "Earthquake explorer",
    subtitle: `Last ${days} day(s), magnitude ${minMag}+`,
    source: "USGS Earthquake Hazards Program",
    sourceUrl: "https://earthquake.usgs.gov",
    query: { days, min_magnitude: minMag, limit },
    valueName: "Magnitude",
    items,
    stats: [
      { label: "Events", value: items.length },
      { label: "Strongest", value: max ?? "n/a" },
      { label: "Window", value: `${days}d` },
    ],
  };
}

// Short text the model reads to write its answer.
function summarize(data) {
  const top = [...data.items].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 3);
  return (
    `${data.items.length} results from ${data.source} (${data.subtitle}). ` +
    (top.length ? "Top: " + top.map((t) => `${t.label} (${t.value})`).join("; ") + "." : "")
  );
}

// =====================================================================
// Below this line is subject-independent. Do not touch during the hour.
// =====================================================================

function createAppServer() {
  const server = new McpServer({ name: APP_NAME, version: "1.0.0" });

  server.registerResource("explorer-widget", WIDGET_URI, { mimeType: "text/html+skybridge" }, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: "text/html+skybridge",
        text: WIDGET_HTML,
        _meta: {
          "openai/widgetPrefersBorder": true,
          "openai/widgetDescription": "Interactive explorer showing live results with filters, sorting and details.",
        },
      },
    ],
  }));

  server.registerResource("explorer-widget-app", APPS_URI, { mimeType: "text/html;profile=mcp-app" }, async () => ({
    contents: [{ uri: APPS_URI, mimeType: "text/html;profile=mcp-app", text: WIDGET_HTML }],
  }));

  server.registerTool(
    TOOL_NAME,
    {
      title: TOOL_TITLE,
      description: TOOL_DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Fetching live data",
        "openai/toolInvocation/invoked": "Data loaded",
        ui: { resourceUri: APPS_URI },
        "ui/resourceUri": APPS_URI,
      },
    },
    async (args) => {
      try {
        const data = await fetchData(args ?? {});
        return {
          content: [{ type: "text", text: summarize(data) }],
          structuredContent: data,
          _meta: { "openai/outputTemplate": WIDGET_URI, ui: { resourceUri: APPS_URI } },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Could not fetch data: ${err.message}` }],
        };
      }
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    return res.end();
  }

  // Health check (also used to wake up a sleeping free-tier host)
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(`${APP_NAME} MCP server OK. Endpoint: ${MCP_PATH}`);
  }

  // Raw data as JSON, for quick checks in the browser: /api/data?days=7
  if (req.method === "GET" && url.pathname === "/api/data") {
    try {
      const args = Object.fromEntries(
        [...url.searchParams].map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)])
      );
      const data = await fetchData(args);
      res.writeHead(200, { "content-type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Browser preview of the widget with a fake window.openai, for testing without Athena: /preview?days=7
  if (req.method === "GET" && url.pathname === "/preview") {
    const qs = url.searchParams.toString();
    const mock = `<script>
      window.openai = {
        toolOutput: null,
        widgetState: null,
        setWidgetState(s) { this.widgetState = s; },
        async callTool(name, args) {
          const p = new URLSearchParams(args).toString();
          const r = await fetch('/api/data?' + p);
          return { structuredContent: await r.json() };
        }
      };
      window.__previewInit = fetch('/api/data?${qs}').then(r => r.json()).then(d => {
        window.openai.toolOutput = d;
        window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { toolOutput: d } } }));
      });
    </script>`;
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(mock + WIDGET_HTML);
  }

  // MCP endpoint (stateless Streamable HTTP)
  if (url.pathname === MCP_PATH && ["POST", "GET", "DELETE"].includes(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const server = createAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      let body;
      if (req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try { body = JSON.parse(Buffer.concat(chunks).toString() || "null"); } catch (_) { body = undefined; }
        const msgs = Array.isArray(body) ? body : [body];
        console.log("MCP", msgs.map(m => m?.method + (m?.params?.name ? `(${m.params.name})` : m?.params?.uri ? `(${m.params.uri})` : "")).join(", "),
          "| ua:", req.headers["user-agent"] ?? "-");
      }
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("MCP error:", err);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`MCP server on http://localhost:${port}${MCP_PATH}`);
  console.log(`Widget preview on http://localhost:${port}/preview`);
});
