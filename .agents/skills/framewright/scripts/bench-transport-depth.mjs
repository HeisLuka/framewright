#!/usr/bin/env node
import puppeteer from "puppeteer";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", countS = "32"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const count = Math.max(8, Math.round(Number(countS) || 32));
const seed = Math.round(Number(process.env.SEED) || 7);
const depths = String(process.env.DEPTHS || "1,2,4,8")
  .split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0);

const contentType = (filename) => {
  switch (path.extname(filename).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
};

let receivedBytes = 0;
let receivedRequests = 0;
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/__fw_transport_sink") {
    request.on("data", (chunk) => { receivedBytes += chunk.length; });
    request.on("end", () => {
      receivedRequests += 1;
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
    });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405); response.end(); return;
  }
  const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.writeHead(403); response.end(); return;
  }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": contentType(filename), "Cache-Control": "no-store" });
    if (request.method === "HEAD") { response.end(); return; }
    fs.createReadStream(filename).pipe(response);
  });
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("could not bind transport benchmark server");
const origin = `http://127.0.0.1:${address.port}`;
const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");
const url = new URL(`/${htmlRelative}`, origin);
url.searchParams.set("f", "0");
url.searchParams.set("w", String(width));
url.searchParams.set("s", String(seed));

let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
    args: process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  const page = await browser.newPage();
  await page.goto(url.href, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__ready===true", { timeout: 120000 });

  const result = await page.evaluate(async ({ width, seed, count, depths }) => {
    const canvas = document.querySelector("canvas");
    if (!canvas || !window.RISO?.render) throw new Error("transport benchmark requires RISO.render");
    window.RISO.render(0, width, seed);
    const context = canvas.getContext("2d", { alpha: false });
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const bytesPerFrame = rgba.byteLength;
    const runs = [];

    const upload = async () => {
      const response = await fetch("/__fw_transport_sink", { method: "POST", body: rgba });
      if (!response.ok) throw new Error(`transport sink returned ${response.status}`);
    };

    for (const depth of depths) {
      await upload();
      const started = performance.now();
      let launched = 0;
      const active = new Set();
      while (launched < count || active.size) {
        while (launched < count && active.size < depth) {
          const promise = upload().finally(() => active.delete(promise));
          active.add(promise);
          launched += 1;
        }
        if (active.size) await Promise.race(active);
      }
      const milliseconds = performance.now() - started;
      runs.push({
        depth,
        count,
        milliseconds,
        millisecondsPerFrame: milliseconds / count,
        framesPerSecond: count / Math.max(milliseconds / 1000, 1e-9),
        mebibytesPerSecond: (count * bytesPerFrame / 1024 / 1024) / Math.max(milliseconds / 1000, 1e-9),
      });
    }
    return { width: canvas.width, height: canvas.height, bytesPerFrame, runs };
  }, { width, seed, count, depths });

  const baseline = result.runs.find((run) => run.depth === 1) || result.runs[0];
  result.runs = result.runs.map((run) => ({
    ...run,
    throughputVsDepth1: run.framesPerSecond / Math.max(baseline.framesPerSecond, 1e-9),
  }));
  const depth4 = result.runs.find((run) => run.depth === 4);
  const best = [...result.runs].sort((a, b) => b.framesPerSecond - a.framesPerSecond)[0];
  const output = {
    experiment: "E19-transport-depth",
    html,
    seed,
    ...result,
    serverObserved: { receivedRequests, receivedBytes },
    hypothesis: {
      statement: "Per-frame request/ack serialization is material if upload depth 4 improves aggregate transport throughput by at least 50% over depth 1.",
      depth4ConfirmedAt50Percent: Boolean(depth4 && depth4.throughputVsDepth1 >= 1.5),
    },
    best: {
      depth: best.depth,
      framesPerSecond: best.framesPerSecond,
      mebibytesPerSecond: best.mebibytesPerSecond,
      throughputVsDepth1: best.throughputVsDepth1,
    },
    caveat: "This isolates Browser -> localhost Node upload into a no-op sink. It does not include FFmpeg or ordered-write backpressure.",
  };
  console.log(JSON.stringify(output, null, 2));
  if (outS) {
    const out = path.resolve(outS);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
