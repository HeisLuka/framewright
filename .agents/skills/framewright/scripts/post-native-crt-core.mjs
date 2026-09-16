import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";

const binary = path.resolve(process.env.CRT_NATIVE_BIN || "artifacts/crt-core");
if (!fs.existsSync(binary)) {
  throw new Error(`CRT_NATIVE_BIN does not exist: ${binary}`);
}

const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
const refChild = () => { child.ref(); child.stdin.ref?.(); child.stdout.ref?.(); };
const unrefChild = () => { child.unref(); child.stdin.unref?.(); child.stdout.unref?.(); };
let failed = null;
let stdoutBuffer = Buffer.alloc(0);
const waiters = [];

const fail = (error) => {
  if (!failed) failed = error instanceof Error ? error : new Error(String(error));
  while (waiters.length) waiters.shift().reject(failed);
};

const flush = () => {
  while (waiters.length && stdoutBuffer.length >= waiters[0].bytes) {
    const waiter = waiters.shift();
    const result = stdoutBuffer.subarray(0, waiter.bytes);
    stdoutBuffer = stdoutBuffer.subarray(waiter.bytes);
    waiter.resolve(result);
  }
};

child.stdout.on("data", (chunk) => {
  stdoutBuffer = stdoutBuffer.length ? Buffer.concat([stdoutBuffer, chunk]) : chunk;
  flush();
});
child.once("error", fail);
child.once("exit", (code, signal) => {
  if (code !== 0) fail(new Error(`native CRT exited with ${code ?? signal}`));
});

const readExact = (bytes) => {
  if (failed) return Promise.reject(failed);
  if (stdoutBuffer.length >= bytes) {
    const result = stdoutBuffer.subarray(0, bytes);
    stdoutBuffer = stdoutBuffer.subarray(bytes);
    return Promise.resolve(result);
  }
  return new Promise((resolve, reject) => {
    waiters.push({ bytes, resolve, reject });
  });
};

const writeBuffer = async (buffer) => {
  if (failed) throw failed;
  if (!child.stdin.write(buffer)) await once(child.stdin, "drain");
};

const finite = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const createHeader = (packet, context) => {
  const post = packet.metadata?.controls?.post || {};
  const header = Buffer.allocUnsafe(97);
  header.write("FWC1", 0, 4, "ascii");
  let offset = 4;
  header.writeUInt32LE(context.width >>> 0, offset); offset += 4;
  header.writeUInt32LE(context.height >>> 0, offset); offset += 4;
  header.writeUInt32LE(context.frame >>> 0, offset); offset += 4;
  header.writeUInt32LE(Number(packet.metadata?.seed || 0) >>> 0, offset); offset += 4;
  const doubles = [
    finite(post.barrel, 0.06),
    finite(post.ca, 0.0022),
    finite(post.caX, 0.9),
    finite(post.vig, 0.30),
    finite(post.gain, 1.10),
    finite(post.flick, 1),
    finite(post.grain, 9),
    finite(post.grainMultiplier, 1),
    finite(post.wobble, 0),
  ];
  for (const value of doubles) {
    header.writeDoubleLE(value, offset);
    offset += 8;
  }
  header[offset++] = post.skip ? 1 : 0;
  header.writeUInt32LE(packet.rgba.byteLength >>> 0, offset);
  return header;
};

export const processFrame = async (packet, context) => {
  refChild();
  try {
    if (!(packet?.rgba instanceof Uint8Array)) throw new Error("native CRT requires RGBA bytes");
    const expected = context.width * context.height * 4;
    if (packet.rgba.byteLength !== expected) {
      throw new Error(`native CRT expected ${expected} bytes, got ${packet.rgba.byteLength}`);
    }
    const header = createHeader(packet, context);
    const rgba = Buffer.from(packet.rgba.buffer, packet.rgba.byteOffset, packet.rgba.byteLength);
    await writeBuffer(header);
    await writeBuffer(rgba);
    return await readExact(expected);
  } finally {
    unrefChild();
  }
};

export const close = async () => {
  refChild();
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
  if (child.exitCode == null && child.signalCode == null) await once(child, "exit");
};

process.once("exit", () => {
  try { if (child.exitCode == null) child.kill("SIGTERM"); } catch {}
});

export default processFrame;
