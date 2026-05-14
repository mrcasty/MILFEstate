#!/usr/bin/env node
// Downloads the published CSV, scrapes reverse.estate photo pages,
// downloads the first image, resizes it to a thumbnail, and saves it
// to thumbs/{id}.webp. Also maintains thumb-map.json for URL mapping.
//
// Usage:  node scrape-thumbs.js
//         node scrape-thumbs.js --concurrency 20

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0D8NXWZ7ViUeHxH0XNdGycpf0fxaAEHAYqDGrMIbNYo4mrjT3WdoSjcPSeHO6TQ/pub?output=csv";
const MAP_FILE = path.join(__dirname, "thumb-map.json");
const THUMB_DIR = path.join(__dirname, "thumbs");
const THUMB_WIDTH = 200;
const CONCURRENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--concurrency") || "5");
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--limit") || "0");

let sharp;

/* ── Helpers ── */

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

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "MILFEstate-thumbbot/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
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

async function scrapeAndThumb(id) {
  try {
    // 1. Scrape photo page to find image URL
    const { status, body } = await fetchText(`https://reverse.estate/photos/${id}`);
    if (status === 404) return null;
    const m = body.match(/src="(\/storage\/photos\/[^"]*?\/0\.jpg[^"]*)"/);
    if (!m) return null;
    const imgUrl = `https://reverse.estate${m[1].split("?")[0]}`;

    // 2. Download the image
    const { status: imgStatus, body: imgBuf } = await fetchBuffer(imgUrl);
    if (imgStatus !== 200 || imgBuf.length < 1000) return null;

    // 3. Resize to thumbnail
    const thumbPath = path.join(THUMB_DIR, `${id}.webp`);
    await sharp(imgBuf).resize(THUMB_WIDTH).webp({ quality: 70 }).toFile(thumbPath);

    return imgUrl;
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
      const url = await scrapeAndThumb(id);
      if (url) map[id] = url;
      done++;
      if (done % 100 === 0 || done === total) onProgress(done, total, Object.keys(map).length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
}

/* ── Main ── */

(async () => {
  // Ensure sharp is available
  try {
    sharp = require("sharp");
  } catch {
    console.log("Installing sharp...");
    execSync("npm install --no-save sharp", { stdio: "inherit", cwd: __dirname });
    sharp = require("sharp");
  }

  // Ensure thumbs directory exists
  if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR);

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

  // Only scrape IDs that don't have a thumbnail yet
  let todo = allIds.filter((id) => !fs.existsSync(path.join(THUMB_DIR, `${id}.webp`)));
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);
  console.log(`${allIds.length} listings, ${todo.length} to process${LIMIT ? ` (limited to ${LIMIT})` : ""}`);

  if (todo.length === 0) {
    console.log("All thumbnails up to date.");
    process.exit(0);
  }

  // Scrape and generate thumbnails
  console.log(`Processing with concurrency ${CONCURRENCY}...`);
  await runBatch(todo, CONCURRENCY, map, (done, total, mapped) => {
    const pct = ((done / total) * 100).toFixed(1);
    console.log(`${done}/${total} (${pct}%) — ${mapped} total mapped`);
  });

  // Save map
  fs.writeFileSync(MAP_FILE, JSON.stringify(map), "utf-8");
  console.log(`Done. ${Object.keys(map).length} entries in thumb-map.json`);

  // Count thumbnails
  const thumbCount = fs.readdirSync(THUMB_DIR).filter((f) => f.endsWith(".webp")).length;
  console.log(`${thumbCount} thumbnails in thumbs/`);
})();
