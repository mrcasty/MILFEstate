#!/usr/bin/env node
// Scrapes reverse.estate photo pages to find the direct URL of the first
// image for each listing. Saves { id: imageUrl } to thumb-map.json.
//
// Usage:  node scrape-thumbs.js
//         node scrape-thumbs.js --concurrency 10 --limit 100

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0D8NXWZ7ViUeHxH0XNdGycpf0fxaAEHAYqDGrMIbNYo4mrjT3WdoSjcPSeHO6TQ/pub?output=csv";
const MAP_FILE = path.join(__dirname, "thumb-map.json");
const CONCURRENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--concurrency") || "10");
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--limit") || "0");
const LAST = process.argv.includes("--last");

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "MILFEstate-thumbbot/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function parseCSVIds(csv) {
  const ids = new Set();
  const lines = csv.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/^(\d+),([^,]+),/);
    if (match && match[2].trim()) ids.add(match[1]);
  }
  return [...ids];
}

async function scrapeImageUrl(id) {
  try {
    const { status, body } = await fetchText(`https://reverse.estate/photos/${id}`);
    if (status === 404) return null;
    const m = body.match(/src="(\/storage\/photos\/[^"]*?\/0\.jpg[^"]*)"/);
    return m ? `https://reverse.estate${m[1]}` : null;
  } catch {
    return null;
  }
}

async function runBatch(ids, concurrency, map, onProgress) {
  let idx = 0;
  let done = 0;
  const total = ids.length;

  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++];
      const url = await scrapeImageUrl(id);
      if (url) map[id] = url;
      done++;
      if (done % 200 === 0 || done === total) onProgress(done, total, Object.keys(map).length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
}

(async () => {
  // Load existing map
  let map = {};
  if (fs.existsSync(MAP_FILE)) {
    try {
      map = JSON.parse(fs.readFileSync(MAP_FILE, "utf-8"));
      console.log(`Loaded existing map: ${Object.keys(map).length} entries`);
    } catch { console.log("Could not parse existing map, starting fresh"); }
  }

  // Download CSV
  console.log("Downloading spreadsheet...");
  const { body: csv } = await fetchText(SHEET_URL);
  const allIds = parseCSVIds(csv);
  let todo = allIds.filter((id) => !map[id]);
  if (LAST) todo = todo.slice(-Math.abs(LIMIT || 100));
  else if (LIMIT > 0) todo = todo.slice(0, LIMIT);
  console.log(`${allIds.length} listings, ${Object.keys(map).length} cached, ${todo.length} to scrape${LIMIT ? ` (limited to ${LIMIT})` : ""}`);

  if (todo.length === 0) {
    console.log("Nothing new to scrape.");
    process.exit(0);
  }

  console.log(`Scraping with concurrency ${CONCURRENCY}...`);
  await runBatch(todo, CONCURRENCY, map, (done, total, mapped) => {
    const pct = ((done / total) * 100).toFixed(1);
    console.log(`${done}/${total} (${pct}%) — ${mapped} total mapped`);
  });

  fs.writeFileSync(MAP_FILE, JSON.stringify(map), "utf-8");
  console.log(`Done. ${Object.keys(map).length} entries saved to thumb-map.json`);
})();
