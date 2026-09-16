#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
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
const RENDERER = path.join(ROOT, ".agents/skills/framewright/scripts/render-webcodecs.mjs");
const INVOCATION_CWD = process.cwd();

const usage = () => {
  console.error(`usage:
  node .agents/skills/framewright/scripts/book-ad-fast.mjs [options]

book source:
  --book-id <id>                 fetch a Newboo book
  --book-json <path>             read BookResponse / BookRepositoryRow / {book: ...}
  --api-base <url>               default NEWBOO_API_BASE or http://127.0.0.1:8000/api/v1
  --authorization <value>        default NEWBOO_AUTHORIZATION
  --cookie <value>               default NEWBOO_COOKIE
  --public-only                  skip admin read

creative overrides:
  --hook <text> --quote <text> --cta <text> --genre <text> --cover-id <id>

assets/render:
  --cover-file <path>            already staged cover
  --cover-url <url>              download and stage cover
  --strict-assets                fail if no cover can be staged
  --track <path>                 optional audio track
  --seed <n>                     default 7
  --width <px>                   default 1080
  --bitrate <bps>                override WebCodecs bitrate policy
  --retries <n>                  renderer retries, default 1
  --out <path>                   default book-ad-fast.mp4
  --manifest-out <path>          local render receipt
  --artifact-dir <path>          persistent render_id keyed MP4 cache
  --job-out <path>               immutable render job JSON
  --force                        bypass artifact cache

This is the STANDARD fast path: deterministic Canvas semantics -> WebCodecs H.264
-> MP4/audio mux. Final H.264 bytes are not assumed byte-deterministic; completed
MP4s are cached and reused by stable render_id.
`);
};

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected positional argument: ${token}`);
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
  return options;
};

const nonEmpty = (value) => String(value ?? "").trim();
const flag = (value) => value === true || ["1", "true", "yes", "on"].includes(nonEmpty(value).toLowerCase());
const positiveNumber = (value, fallback, name) => {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number`);
  return number;
};
const nonNegativeInteger = (value, fallback, name) => {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
  return number;
};

const requestHeaders = (options) => {
  const headers = { Accept: "application/json" };
  const authorization = nonEmpty(options.authorization || process.env.NEWBOO_AUTHORIZATION);
  const cookie = nonEmpty(options.cookie || process.env.NEWBOO_COOKIE);
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
};

const apiGetJson = async (url, headers) => {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}: ${(await response.text()).slice(0, 400)}`);
  return response.json();
};

const fetchNewbooBook = async ({ bookId, apiBase, headers, publicOnly }) => {
  const base = apiBase.replace(/\/+$/, "");
  const id = encodeURIComponent(bookId);
  const attempts = publicOnly
    ? [["public", `${base}/books/${id}`]]
    : [["admin", `${base}/admin/books/${id}`], ["public", `${base}/books/${id}`]];
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

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const assetCacheRoot = () => path.resolve(process.env.FRAMEWRIGHT_ASSET_CACHE || path.join(os.tmpdir(), "framewright-book-assets"));

const stageRemoteCover = async (rawUrl, apiBase, apiHeaders) => {
  const url = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : new URL(rawUrl, `${apiBase.replace(/\/+$/, "")}/`).href;
  const headers = {};
  try {
    if (new URL(url).origin === new URL(apiBase).origin) Object.assign(headers, apiHeaders);
  } catch {}
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`cover GET ${response.status} ${response.statusText} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("cover response was empty");
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  const extension = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
  const root = assetCacheRoot();
  await fsp.mkdir(root, { recursive: true });
  const output = path.join(root, `${sha256(url).slice(0, 32)}${extension}`);
  await fsp.writeFile(output, bytes);
  return output;
};

const run = (command, args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with ${code ?? signal}`));
  });
});

const options = parseArgs(process.argv.slice(2));
if (flag(options.help)) {
  usage();
  process.exit(0);
}

const apiBase = nonEmpty(options["api-base"] || process.env.NEWBOO_API_BASE || "http://127.0.0.1:8000/api/v1");
const apiHeaders = requestHeaders(options);
let bookInput;
if (options["book-json"]) {
  bookInput = JSON.parse(await fsp.readFile(path.resolve(INVOCATION_CWD, String(options["book-json"])), "utf8"));
} else if (nonEmpty(options["book-id"])) {
  bookInput = await fetchNewbooBook({
    bookId: nonEmpty(options["book-id"]),
    apiBase,
    headers: apiHeaders,
    publicOnly: flag(options["public-only"]),
  });
} else {
  usage();
  throw new Error("--book-id or --book-json is required");
}

const payload = newbooBookToRenderPayload(bookInput, {
  hook: options.hook,
  quote: options.quote,
  cta: options.cta,
  genre: options.genre,
  coverId: options["cover-id"],
  coverTarget: "source",
  bucket: process.env.S3_BUCKET_NAME,
});
const job = createBookAdV0Job(payload);
if (options["job-out"]) {
  const jobOut = path.resolve(INVOCATION_CWD, String(options["job-out"]));
  await fsp.mkdir(path.dirname(jobOut), { recursive: true });
  await fsp.writeFile(jobOut, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

let stagedCover = null;
if (options["cover-file"]) {
  stagedCover = path.resolve(INVOCATION_CWD, String(options["cover-file"]));
  const stat = await fsp.stat(stagedCover);
  if (!stat.isFile()) throw new Error(`--cover-file is not a file: ${stagedCover}`);
} else {
  const remote = nonEmpty(options["cover-url"] || payload.cover?.publicUrl);
  if (remote) {
    try {
      stagedCover = await stageRemoteCover(remote, apiBase, apiHeaders);
    } catch (error) {
      if (flag(options["strict-assets"])) throw error;
      console.warn(`cover staging failed: ${error.message}`);
    }
  }
}
if (!stagedCover && flag(options["strict-assets"])) {
  throw new Error("no book cover could be staged; prototype fast path currently needs --cover-file/--cover-url or a public cover_url");
}

const query = new URLSearchParams();
query.set("job", encodeBookRenderJob(job));
if (stagedCover) {
  query.set("coverUrl", pathToFileURL(stagedCover).href);
  query.set("coverCrossOrigin", "off");
}
if (flag(options["strict-assets"])) query.set("strictAssets", "1");

const out = path.resolve(INVOCATION_CWD, nonEmpty(options.out || "book-ad-fast.mp4"));
const seed = Math.round(positiveNumber(options.seed, 7, "--seed"));
const width = Math.round(positiveNumber(options.width, 1080, "--width"));
const retries = nonNegativeInteger(options.retries, 1, "--retries");
const env = {
  HTML: BOOK_AD_HTML,
  FW_ROOT: ROOT,
  FW_QUERY: query.toString(),
  WEBCODECS_RETRIES: String(retries),
};
if (options.bitrate) env.WEBCODECS_BITRATE = String(Math.round(positiveNumber(options.bitrate, null, "--bitrate")));
if (options.track) env.TRACK = path.resolve(INVOCATION_CWD, String(options.track));
if (options["artifact-dir"]) env.FW_ARTIFACT_DIR = path.resolve(INVOCATION_CWD, String(options["artifact-dir"]));
if (options["manifest-out"]) env.MANIFEST_OUT = path.resolve(INVOCATION_CWD, String(options["manifest-out"]));
if (flag(options.force)) env.FORCE = "1";

console.log(`fast book ad: ${payload.id} -> ${out}`);
console.log(`cover staged: ${stagedCover || "none (template fallback)"}`);
await run(process.execPath, [RENDERER, out, String(seed), String(width)], env);
