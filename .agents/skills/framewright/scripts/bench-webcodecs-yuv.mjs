#!/usr/bin/env node
import puppeteer from "puppeteer";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", countS = "12"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const count = Math.max(2, Math.round(Number(countS) || 12));
const seed = Math.round(Number(process.env.SEED) || 7);

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
  if (request.method === "POST" && requestUrl.pathname === "/__fw_yuv_sink") {
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
if (!address || typeof address === "string") throw new Error("could not bind WebCodecs benchmark server");
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

  const result = await page.evaluate(async ({ width, seed, count }) => {
    const canvas = document.querySelector("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    const runtime = window.RISO;
    const upload = async (body) => {
      const response = await fetch("/__fw_yuv_sink", { method: "POST", body });
      if (!response.ok) throw new Error(`YUV sink returned ${response.status}`);
    };
    const runRgba = async () => {
      runtime.render(0, width, seed);
      await upload(context.getImageData(0, 0, canvas.width, canvas.height).data);
      const started = performance.now();
      for (let index = 0; index < count; index += 1) {
        runtime.render(index, width, seed);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        await upload(rgba);
      }
      const milliseconds = performance.now() - started;
      return {
        supported: true,
        milliseconds,
        millisecondsPerFrame: milliseconds / count,
        framesPerSecond: count / Math.max(milliseconds / 1000, 1e-9),
        bytesPerFrame: canvas.width * canvas.height * 4,
      };
    };
    const runYuv = async (format) => {
      if (typeof VideoFrame !== "function") return { supported: false, error: "VideoFrame unavailable" };
      const convert = async (index, doUpload) => {
        runtime.render(index, width, seed);
        const frame = new VideoFrame(canvas, { timestamp: Math.trunc(index * 1_000_000 / 30) });
        try {
          const options = { format };
          const size = frame.allocationSize(options);
          const bytes = new Uint8Array(size);
          const layout = await frame.copyTo(bytes, options);
          if (doUpload) await upload(bytes);
          return { size, sourceFormat: frame.format, layout };
        } finally {
          frame.close();
        }
      };
      try {
        const warm = await convert(0, true);
        let started = performance.now();
        for (let index = 0; index < count; index += 1) await convert(index, false);
        const convertMilliseconds = performance.now() - started;
        started = performance.now();
        for (let index = 0; index < count; index += 1) await convert(index, true);
        const convertUploadMilliseconds = performance.now() - started;
        return {
          supported: true,
          sourceFormat: warm.sourceFormat,
          bytesPerFrame: warm.size,
          layout: warm.layout,
          convertMillisecondsPerFrame: convertMilliseconds / count,
          convertFramesPerSecond: count / Math.max(convertMilliseconds / 1000, 1e-9),
          convertUploadMillisecondsPerFrame: convertUploadMilliseconds / count,
          convertUploadFramesPerSecond: count / Math.max(convertUploadMilliseconds / 1000, 1e-9),
        };
      } catch (error) {
        return { supported: false, error: `${error?.name || "Error"}: ${error?.message || error}` };
      }
    };

    const rgba = await runRgba();
    const i420 = await runYuv("I420");
    const nv12 = await runYuv("NV12");
    return {
      width: canvas.width,
      height: canvas.height,
      rgba,
      i420,
      nv12,
      capabilities: {
        VideoFrame: typeof VideoFrame === "function",
        VideoEncoder: typeof VideoEncoder === "function",
      },
    };
  }, { width, seed, count });

  const candidate = result.i420.supported ? result.i420 : result.nv12;
  const yuvFps = candidate.supported ? candidate.convertUploadFramesPerSecond : 0;
  const speedup = yuvFps / Math.max(result.rgba.framesPerSecond, 1e-9);
  const output = {
    experiment: "E21-webcodecs-yuv-copy",
    html,
    seed,
    count,
    ...result,
    hypothesis: {
      statement: "A browser-native YUV copy path is worth a production prototype if I420 or NV12 conversion is supported and render+convert+upload is at least 25% faster than render+getImageData+RGBA upload.",
      supported: candidate.supported,
      selectedFormat: result.i420.supported ? "I420" : result.nv12.supported ? "NV12" : null,
      speedupVsRgba: speedup,
      confirmedAt25Percent: candidate.supported && speedup >= 1.25,
    },
    caveat: "This benchmarks VideoFrame.copyTo conversion plus localhost upload into a no-op sink. It does not encode video and still performs a CPU-visible YUV copy.",
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
