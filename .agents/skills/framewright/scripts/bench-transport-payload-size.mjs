#!/usr/bin/env node
import puppeteer from "puppeteer";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", countS = "24"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const count = Math.max(8, Math.round(Number(countS) || 24));
const seed = Math.round(Number(process.env.SEED) || 7);
const depth = Math.max(1, Math.round(Number(process.env.DEPTH) || 2));

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

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/__fw_payload_sink") {
    request.resume();
    request.on("end", () => { response.writeHead(204); response.end(); });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
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
if (!address || typeof address === "string") throw new Error("could not bind payload benchmark server");
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

  const measured = await page.evaluate(async ({ width, seed, count, depth }) => {
    const canvas = document.querySelector("canvas");
    window.RISO.render(0, width, seed);
    const rgba = canvas.getContext("2d", { alpha: false }).getImageData(0, 0, canvas.width, canvas.height).data;
    const rgbaBytes = rgba.byteLength;
    const cases = [
      { label: "rgba", ratio: 1 },
      { label: "rgb24-sized", ratio: 0.75 },
      { label: "nv12-sized", ratio: 0.375 },
      { label: "quarter-sized", ratio: 0.25 },
    ];
    const results = [];

    const runCase = async ({ label, ratio }) => {
      const payload = ratio === 1 ? rgba : new Uint8Array(Math.max(1, Math.floor(rgbaBytes * ratio)));
      const upload = async () => {
        const response = await fetch("/__fw_payload_sink", { method: "POST", body: payload });
        if (!response.ok) throw new Error(`payload sink returned ${response.status}`);
      };
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
      return {
        label,
        ratio,
        payloadBytes: payload.byteLength,
        milliseconds,
        millisecondsPerPayload: milliseconds / count,
        payloadsPerSecond: count / Math.max(milliseconds / 1000, 1e-9),
        mebibytesPerSecond: (count * payload.byteLength / 1024 / 1024) / Math.max(milliseconds / 1000, 1e-9),
      };
    };

    for (const item of cases) results.push(await runCase(item));
    return { width: canvas.width, height: canvas.height, rgbaBytes, depth, count, results };
  }, { width, seed, count, depth });

  const rgba = measured.results.find((item) => item.label === "rgba");
  const nv12 = measured.results.find((item) => item.label === "nv12-sized");
  const result = {
    experiment: "E20-transport-payload-size",
    html,
    seed,
    ...measured,
    results: measured.results.map((item) => ({
      ...item,
      speedupVsRgba: rgba.millisecondsPerPayload / Math.max(item.millisecondsPerPayload, 1e-9),
    })),
    hypothesis: {
      statement: "Transport is materially byte-volume limited if an NV12-sized payload (37.5% of RGBA bytes) is at least 1.5x faster per payload than RGBA at the same concurrency depth.",
      confirmedAt1_5x: rgba.millisecondsPerPayload / Math.max(nv12.millisecondsPerPayload, 1e-9) >= 1.5,
      nv12SizedSpeedupVsRgba: rgba.millisecondsPerPayload / Math.max(nv12.millisecondsPerPayload, 1e-9),
    },
    caveat: "The NV12-sized payload is only a byte-count proxy. This benchmark does not perform RGBA->NV12 conversion and does not prove an end-to-end NV12 renderer win.",
  };
  console.log(JSON.stringify(result, null, 2));
  if (outS) {
    const out = path.resolve(outS);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
