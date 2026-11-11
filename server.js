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

const APP_NAME = "air-quality-dashboard";
const TOOL_NAME = "compare_air_quality";
const TOOL_TITLE = "Compare air quality across cities";
const TOOL_DESCRIPTION =
  "Use this when the user asks about air quality, air pollution, smog, AQI, PM2.5, PM10, NO2 or ozone " +
  "in one or more cities, or wants to compare cities. Fetches live hourly data from the Open-Meteo Air Quality API " +
  "(CAMS) and shows an interactive comparison dashboard widget with severity levels.";

const POLLUTANTS = {
  aqi: { name: "Overall AQI", aqi: "us_aqi", raw: null, unit: "" },
  pm2_5: { name: "PM2.5", aqi: "us_aqi_pm2_5", raw: "pm2_5", unit: "µg/m³" },
  pm10: { name: "PM10", aqi: "us_aqi_pm10", raw: "pm10", unit: "µg/m³" },
  nitrogen_dioxide: { name: "NO2", aqi: "us_aqi_nitrogen_dioxide", raw: "nitrogen_dioxide", unit: "µg/m³" },
  ozone: { name: "O3", aqi: "us_aqi_ozone", raw: "ozone", unit: "µg/m³" },
};

// Default comparison set: major cities across all continents.
const CITIES = [
  ["Delhi", "India", 28.61, 77.21], ["Beijing", "China", 39.9, 116.4], ["Lahore", "Pakistan", 31.55, 74.34],
  ["Dhaka", "Bangladesh", 23.81, 90.41], ["Cairo", "Egypt", 30.04, 31.24], ["Jakarta", "Indonesia", -6.21, 106.85],
  ["Mumbai", "India", 19.08, 72.88], ["Bangkok", "Thailand", 13.76, 100.5], ["Tokyo", "Japan", 35.68, 139.69],
  ["Seoul", "South Korea", 37.57, 126.98], ["Shanghai", "China", 31.23, 121.47], ["Dubai", "UAE", 25.2, 55.27],
  ["Istanbul", "Turkey", 41.01, 28.98], ["Moscow", "Russia", 55.76, 37.62], ["Paris", "France", 48.86, 2.35],
  ["London", "United Kingdom", 51.51, -0.13], ["Berlin", "Germany", 52.52, 13.41], ["Madrid", "Spain", 40.42, -3.7],
  ["Rome", "Italy", 41.9, 12.5], ["Tunis", "Tunisia", 36.81, 10.18], ["Lagos", "Nigeria", 6.52, 3.38],
  ["Johannesburg", "South Africa", -26.2, 28.05], ["Nairobi", "Kenya", -1.29, 36.82], ["New York", "USA", 40.71, -74.01],
  ["Los Angeles", "USA", 34.05, -118.24], ["Mexico City", "Mexico", 19.43, -99.13], ["Sao Paulo", "Brazil", -23.55, -46.63],
  ["Buenos Aires", "Argentina", -34.6, -58.38], ["Sydney", "Australia", -33.87, 151.21], ["Toronto", "Canada", 43.65, -79.38],
];

function severity(aqi) {
  if (aqi == null) return "n/a";
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for sensitive groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

// Inputs the model (and the widget) can pass. Keep defaults so every arg is optional.
const INPUT_SCHEMA = {
  pollutant: z.enum(["aqi", "pm2_5", "pm10", "nitrogen_dioxide", "ozone"]).default("aqi")
    .describe("Pollutant to compare: aqi (overall US AQI), pm2_5, pm10, nitrogen_dioxide or ozone"),
  days: z.number().int().min(1).max(7).default(1)
    .describe("Time window: average over the last N days (1-7)"),
  cities: z.string().default("")
    .describe("Optional comma separated city names to compare, e.g. 'Paris, Delhi, Tunis'. Empty = 30 major world cities"),
};

async function geocode(name) {
  const known = CITIES.find((c) => c[0].toLowerCase() === name.toLowerCase());
  if (known) return known;
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
  const j = r.ok ? await r.json() : {};
  const g = j.results?.[0];
  return g ? [g.name, g.country ?? "", g.latitude, g.longitude] : null;
}

async function fetchData(args) {
  const pollutant = POLLUTANTS[args.pollutant] ? args.pollutant : "aqi";
  const days = Math.min(7, Math.max(1, Number(args.days) || 1));
  const citiesArg = String(args.cities ?? "").trim();
  const p = POLLUTANTS[pollutant];

  let cities = CITIES;
  if (citiesArg) {
    const names = citiesArg.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    cities = (await Promise.all(names.map(geocode))).filter(Boolean);
    if (!cities.length) throw new Error(`No matching cities for "${citiesArg}"`);
  }

  const hourly = [p.aqi, p.raw].filter(Boolean).join(",");
  const url =
    "https://air-quality-api.open-meteo.com/v1/air-quality?timezone=GMT&forecast_days=1" +
    `&past_days=${days}&hourly=${hourly}` +
    `&latitude=${cities.map((c) => c[2]).join(",")}&longitude=${cities.map((c) => c[3]).join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  let json = await res.json();
  if (!Array.isArray(json)) json = [json];

  const now = Date.now(), from = now - days * 86400000;
  const items = json.map((loc, i) => {
    const [name, country, lat, lon] = cities[i];
    const t = loc.hourly.time.map((s) => Date.parse(s + "Z"));
    const idx = t.map((ts, k) => k).filter((k) => t[k] <= now && t[k] > from && loc.hourly[p.aqi][k] != null);
    const aqis = idx.map((k) => loc.hourly[p.aqi][k]);
    if (!aqis.length) return null;
    const avg = Math.round(aqis.reduce((a, b) => a + b, 0) / aqis.length);
    const peakK = idx[aqis.indexOf(Math.max(...aqis))];
    const lastK = idx[idx.length - 1];
    const raws = p.raw ? idx.map((k) => loc.hourly[p.raw][k]).filter((v) => v != null) : [];
    const details = {
      Severity: severity(avg),
      "Current AQI": loc.hourly[p.aqi][lastK],
      "Peak AQI": loc.hourly[p.aqi][peakK],
      "Peak time (UTC)": new Date(t[peakK]).toISOString().slice(0, 16).replace("T", " "),
    };
    if (raws.length) details[`Avg ${p.name} (${p.unit})`] = (raws.reduce((a, b) => a + b, 0) / raws.length).toFixed(1);
    details.Country = country;
    return {
      id: `${name}-${lat}`,
      label: country ? `${name}, ${country}` : name,
      value: avg,
      time: new Date(t[peakK]).toISOString(),
      lat, lon,
      url: `https://open-meteo.com/en/docs/air-quality-api?latitude=${lat}&longitude=${lon}`,
      details,
    };
  }).filter(Boolean);

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const worst = sorted[0], best = sorted[sorted.length - 1];
  return {
    title: `Air quality: ${p.name}`,
    subtitle: `US AQI for ${p.name}, average over the last ${days === 1 ? "24 hours" : days + " days"}, ${items.length} cities`,
    source: "Open-Meteo Air Quality API (Copernicus CAMS)",
    sourceUrl: "https://open-meteo.com/en/docs/air-quality-api",
    query: { pollutant, days, cities: citiesArg },
    valueName: `${p.name} AQI`,
    items,
    stats: [
      { label: "Worst", value: worst ? `${worst.label.split(",")[0]} ${worst.value}` : "n/a" },
      { label: "Cleanest", value: best ? `${best.label.split(",")[0]} ${best.value}` : "n/a" },
      { label: "Unhealthy (AQI > 100)", value: items.filter((i) => i.value > 100).length },
    ],
  };
}

// Short text the model reads to write its answer.
function summarize(data) {
  const s = [...data.items].sort((a, b) => b.value - a.value);
  const fmt = (t) => `${t.label} AQI ${t.value} (${t.details.Severity})`;
  return (
    `${data.title}. ${data.subtitle}. Source: ${data.source}. ` +
    (s.length ? `Worst: ${s.slice(0, 3).map(fmt).join("; ")}. Cleanest: ${fmt(s[s.length - 1])}.` : "No data.")
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
        [...url.searchParams].map(([k, v]) => [k, v === "" || isNaN(Number(v)) ? v : Number(v)])
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
        console.log("MCP", msgs.map(m => m?.method + (m?.params?.name ? `(${m.params.name} ${JSON.stringify(m.params.arguments ?? null)})` : m?.params?.uri ? `(${m.params.uri})` : "")).join(", "),
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
