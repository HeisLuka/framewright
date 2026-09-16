#!/usr/bin/env node
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createBookAdV0Job,
  encodeBookRenderJob,
  newbooBookToRenderPayload,
} from "../../../../src/book-render.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../../../..");
const BOOK_AD_HTML = path.join(ROOT, "examples/book-ad-v0/index.html");
const LOOK_SCRIPT = path.join(ROOT, ".agents/skills/framewright/scripts/look.mjs");
const RENDER_SCRIPT = path.join(ROOT, ".agents/skills/framewright/scripts/render.mjs");
const BUILD_SCRIPT = path.join(ROOT, ".agents/skills/framewright/scripts/build.sh");
const INVOCATION_CWD = process.cwd();

const usage = () => {
  console.error(`usage:
  node .agents/skills/framewright/scripts/book-ad.mjs <info|sheet|shot|render|video> [options]

book source:
  --book-id <id>                 fetch a Newboo book
  --book-json <path>             read BookResponse / BookRepositoryRow / {book: ...} from JSON
  --api-base <url>               default: NEWBOO_API_BASE or http://127.0.0.1:8000/api/v1
  --authorization <value>        default: NEWBOO_AUTHORIZATION
  --cookie <value>               default: NEWBOO_COOKIE
  --public-only                  skip the admin read that can expose cover_id

creative overrides (deterministic, no generated copy):
  --hook <text>
  --quote <text>
  --cta <text>
  --genre <text>
  --cover-id <id>

cover transport:
  --cover-file <path>            use an already staged local cover
  --cover-url <url>              download/stage this URL
  --strict-assets                fail when no cover can be staged
  S3_BUCKET_NAME, S3_ENDPOINT, S3_REGION and AWS_* / YC_* are used when cover_id is known

render:
  --seed <n>                     default: 7
  --width <px>                   shot default 540, render/video default 1080
  --frames <csv>                 shot default 0,90,240,360,449
  --cells <n>                    sheet default 16
  --cell-width <px>              sheet default 270
  --tabs <n>                     render/video default 5
  --frames-dir <path>            render/video default frames
  --out <path>                   sheet/shot/video output path
  --job-out <path>               write the immutable render job JSON
`);
};

const parseArgs = (argv) => {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq > 2) {
      options[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next != null && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positionals, options };
};

const nonEmpty = (value) => {
  const text = String(value ?? "").trim();
  return text || "";
};

const numberOption = (options, key, fallback) => {
  const raw = options[key];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number`);
  return value;
};

const requestHeaders = (options) => {
  const headers = { Accept: "application/json" };
  const authorization = nonEmpty(options.authorization || process.env.NEWBOO_AUTHORIZATION);
  const cookie = nonEmpty(options.cookie || process.env.NEWBOO_COOKIE);
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
};

const readJsonFile = async (filename) => {
  const resolved = path.resolve(INVOCATION_CWD, filename);
  return JSON.parse(await fsp.readFile(resolved, "utf8"));
};

const apiGetJson = async (url, headers) => {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    const error = new Error(`${response.status} ${response.statusText} for ${url}${body ? `: ${body}` : ""}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

const fetchNewbooBook = async ({ bookId, apiBase, headers, publicOnly = false }) => {
  const encodedId = encodeURIComponent(bookId);
  const base = apiBase.replace(/\/+$/, "");
  const attempts = publicOnly
    ? [["public", `${base}/books/${encodedId}`]]
    : [
        ["admin", `${base}/admin/books/${encodedId}`],
        ["public", `${base}/books/${encodedId}`],
      ];
  const failures = [];
  for (const [kind, url] of attempts) {
    try {
      const json = await apiGetJson(url, headers);
      console.log(`Newboo book: ${kind} read ${url}`);
      return json;
    } catch (error) {
      failures.push(`${kind}: ${error.message}`);
    }
  }
  throw new Error(`could not fetch Newboo book ${bookId}\n${failures.join("\n")}`);
};

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value, encoding) => createHmac("sha256", key).update(value).digest(encoding);

const encodePath = (value) => String(value)
  .split("/")
  .filter((part) => part.length > 0)
  .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
  .join("/");

const signedS3Get = async ({ endpoint, region, bucket, key, accessKeyId, secretAccessKey, sessionToken }) => {
  const endpointUrl = new URL(endpoint);
  const basePath = endpointUrl.pathname.replace(/\/+$/, "");
  const canonicalUri = `${basePath}/${encodePath(bucket)}/${encodePath(key)}`.replace(/\/+/g, "/");
  const url = new URL(endpointUrl.origin);
  url.pathname = canonicalUri;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const canonicalHeaderRows = [
    ["host", url.host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (sessionToken) canonicalHeaderRows.push(["x-amz-security-token", sessionToken]);
  canonicalHeaderRows.sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = canonicalHeaderRows.map(([name, value]) => `${name}:${String(value).trim()}\n`).join("");
  const signedHeaders = canonicalHeaderRows.map(([name]) => name).join(";");
  const canonicalRequest = [
    "GET",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  const headers = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;

  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`S3 GET ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
  }
  return response;
};

const extensionFor = (contentType, source = "") => {
  const clean = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  if (clean === "image/jpeg") return ".jpg";
  if (clean === "image/png") return ".png";
  if (clean === "image/webp") return ".webp";
  try {
    const ext = path.extname(new URL(source).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  } catch {}
  return ".img";
};

const cacheRoot = () => path.resolve(
  process.env.FRAMEWRIGHT_ASSET_CACHE || path.join(os.tmpdir(), "framewright-book-assets"),
);

const persistResponse = async (response, identity) => {
  const contentType = response.headers.get("content-type") || "";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("cover response was empty");
  const root = cacheRoot();
  await fsp.mkdir(root, { recursive: true });
  const filename = `${sha256Hex(identity).slice(0, 32)}${extensionFor(contentType, identity)}`;
  const output = path.join(root, filename);
  await fsp.writeFile(output, bytes);
  return output;
};

const resolveRemoteUrl = (coverUrl, apiBase) => {
  const raw = nonEmpty(coverUrl);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, apiBase).href;
  return new URL(raw, `${apiBase.replace(/\/+$/, "")}/`).href;
};

const stageHttpCover = async ({ coverUrl, apiBase, apiHeaders }) => {
  const url = resolveRemoteUrl(coverUrl, apiBase);
  if (!url) return null;
  const headers = {};
  try {
    const apiOrigin = new URL(apiBase).origin;
    const coverOrigin = new URL(url).origin;
    if (apiOrigin === coverOrigin) Object.assign(headers, apiHeaders);
  } catch {}
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`cover GET ${response.status} ${response.statusText} for ${url}`);
  return persistResponse(response, url);
};

const stageS3Cover = async (asset) => {
  const source = asset?.source;
  if (!source || source.type !== "s3" || !source.key) return null;
  const accessKeyId = nonEmpty(process.env.AWS_ACCESS_KEY_ID || process.env.YC_ACCESS_KEY_ID);
  const secretAccessKey = nonEmpty(process.env.AWS_SECRET_ACCESS_KEY || process.env.YC_SECRET_ACCESS_KEY);
  const sessionToken = nonEmpty(process.env.AWS_SESSION_TOKEN);
  const bucket = nonEmpty(source.bucket || process.env.S3_BUCKET_NAME);
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = nonEmpty(process.env.S3_ENDPOINT || process.env.S3_ENDPOINT_URL || "https://storage.yandexcloud.net");
  const region = nonEmpty(process.env.S3_REGION || process.env.AWS_REGION || "ru-central1");
  const response = await signedS3Get({
    endpoint,
    region,
    bucket,
    key: source.key,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });
  return persistResponse(response, `s3://${bucket}/${source.key}`);
};

const stageCover = async ({ payload, options, apiBase, apiHeaders }) => {
  if (options["cover-file"]) {
    const localPath = path.resolve(INVOCATION_CWD, String(options["cover-file"]));
    const stat = await fsp.stat(localPath);
    if (!stat.isFile()) throw new Error(`--cover-file is not a file: ${localPath}`);
    return localPath;
  }

  const explicitUrl = nonEmpty(options["cover-url"]);
  if (explicitUrl) return stageHttpCover({ coverUrl: explicitUrl, apiBase, apiHeaders });

  if (payload.cover?.asset) {
    try {
      const staged = await stageS3Cover(payload.cover.asset);
      if (staged) return staged;
    } catch (error) {
      console.warn(`source cover staging failed: ${error.message}`);
    }
  }

  if (payload.cover?.publicUrl) {
    try {
      return await stageHttpCover({ coverUrl: payload.cover.publicUrl, apiBase, apiHeaders });
    } catch (error) {
      console.warn(`public cover staging failed: ${error.message}`);
    }
  }
  return null;
};

const run = (command, args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with ${code ?? signal}`));
  });
});

const main = async () => {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0] || "sheet";
  if (!["info", "sheet", "shot", "render", "video"].includes(command)) {
    usage();
    process.exitCode = 2;
    return;
  }

  const apiBase = nonEmpty(options["api-base"] || process.env.NEWBOO_API_BASE || "http://127.0.0.1:8000/api/v1");
  const apiHeaders = requestHeaders(options);
  let bookInput;
  if (options["book-json"]) {
    bookInput = await readJsonFile(String(options["book-json"]));
  } else {
    const bookId = nonEmpty(options["book-id"]);
    if (!bookId) {
      usage();
      throw new Error("--book-id or --book-json is required");
    }
    bookInput = await fetchNewbooBook({
      bookId,
      apiBase,
      headers: apiHeaders,
      publicOnly: options["public-only"] === true,
    });
  }

  const creativeOptions = {
    hook: options.hook,
    quote: options.quote,
    cta: options.cta,
    genre: options.genre,
    coverId: options["cover-id"],
    coverTarget: "source",
    bucket: process.env.S3_BUCKET_NAME,
  };
  const payload = newbooBookToRenderPayload(bookInput, creativeOptions);
  const job = createBookAdV0Job(payload);

  if (options["job-out"]) {
    const jobPath = path.resolve(INVOCATION_CWD, String(options["job-out"]));
    await fsp.mkdir(path.dirname(jobPath), { recursive: true });
    await fsp.writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    console.log(`render job: ${jobPath}`);
  }

  let stagedCover = null;
  try {
    stagedCover = await stageCover({ payload, options, apiBase, apiHeaders });
  } catch (error) {
    if (options["strict-assets"] === true) throw error;
    console.warn(`cover staging failed: ${error.message}`);
  }
  if (!stagedCover && options["strict-assets"] === true) {
    throw new Error("no book cover could be staged");
  }
  if (stagedCover) console.log(`cover staged: ${stagedCover}`);
  else console.log("cover staged: none (template fallback will be used)");

  const query = new URLSearchParams();
  query.set("job", encodeBookRenderJob(job));
  if (stagedCover) {
    query.set("coverUrl", pathToFileURL(stagedCover).href);
    query.set("coverCrossOrigin", "off");
  }
  if (options["strict-assets"] === true) query.set("strictAssets", "1");
  const sharedEnv = {
    HTML: BOOK_AD_HTML,
    FW_QUERY: query.toString(),
  };

  const seed = Math.round(numberOption(options, "seed", 7));
  if (command === "info") {
    await run(process.execPath, [LOOK_SCRIPT, "info"], sharedEnv);
    return;
  }
  if (command === "sheet") {
    const cells = Math.round(numberOption(options, "cells", 16));
    const cellWidth = Math.round(numberOption(options, "cell-width", 270));
    const args = [LOOK_SCRIPT, "sheet", String(cells), String(cellWidth), String(seed)];
    if (options.out) args.push(path.resolve(INVOCATION_CWD, String(options.out)));
    await run(process.execPath, args, sharedEnv);
    return;
  }
  if (command === "shot") {
    const frames = nonEmpty(options.frames || "0,90,240,360,449");
    const width = Math.round(numberOption(options, "width", 540));
    const args = [LOOK_SCRIPT, "shot", frames, String(width), String(seed)];
    if (options.out) args.push(path.resolve(INVOCATION_CWD, String(options.out)));
    await run(process.execPath, args, sharedEnv);
    return;
  }

  const framesDir = path.resolve(INVOCATION_CWD, nonEmpty(options["frames-dir"] || "frames"));
  const width = Math.round(numberOption(options, "width", 1080));
  const tabs = Math.round(numberOption(options, "tabs", 5));
  await run(process.execPath, [RENDER_SCRIPT, framesDir, String(seed), String(width), String(tabs)], sharedEnv);
  if (command === "video") {
    const output = path.resolve(INVOCATION_CWD, nonEmpty(options.out || "book-ad-v0.mp4"));
    await run("bash", [BUILD_SCRIPT, output, framesDir], { FPS: String(job.plan.fps) });
  }
};

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
