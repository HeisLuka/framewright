import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";

const binary = path.resolve(process.env.CRT_NATIVE_BIN || "artifacts/crt-core");
if (!fs.existsSync(binary)) {
  throw new Error(`CRT_NATIVE_BIN does not exist: ${binary}`);
}

const poolSize = Math.max(1, Math.min(32, Math.trunc(Number(process.env.CRT_PROCESSES) || 1)));
let activeClients = 0;
let maxActiveClients = 0;
let queuedAcquires = 0;
let maxQueuedAcquires = 0;

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

class NativeClient {
  constructor(index) {
    this.index = index;
    this.child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
    this.failed = null;
    this.stdoutBuffer = Buffer.alloc(0);
    this.readWaiter = null;
    this.child.stdout.on("data", (chunk) => {
      this.stdoutBuffer = this.stdoutBuffer.length
        ? Buffer.concat([this.stdoutBuffer, chunk])
        : chunk;
      this.#flushRead();
    });
    this.child.once("error", (error) => this.#fail(error));
    this.child.once("exit", (code, signal) => {
      if (code !== 0) this.#fail(new Error(`native CRT worker ${index} exited with ${code ?? signal}`));
    });
    this.#unref();
  }

  #fail(error) {
    if (!this.failed) this.failed = error instanceof Error ? error : new Error(String(error));
    if (this.readWaiter) {
      const waiter = this.readWaiter;
      this.readWaiter = null;
      waiter.reject(this.failed);
    }
  }

  #flushRead() {
    if (!this.readWaiter || this.stdoutBuffer.length < this.readWaiter.bytes) return;
    const waiter = this.readWaiter;
    this.readWaiter = null;
    const result = this.stdoutBuffer.subarray(0, waiter.bytes);
    this.stdoutBuffer = this.stdoutBuffer.subarray(waiter.bytes);
    waiter.resolve(result);
  }

  #ref() {
    this.child.ref();
    this.child.stdin.ref?.();
    this.child.stdout.ref?.();
  }

  #unref() {
    this.child.unref();
    this.child.stdin.unref?.();
    this.child.stdout.unref?.();
  }

  async #write(buffer) {
    if (this.failed) throw this.failed;
    if (!this.child.stdin.write(buffer)) await once(this.child.stdin, "drain");
  }

  #readExact(bytes) {
    if (this.failed) return Promise.reject(this.failed);
    if (this.readWaiter) return Promise.reject(new Error(`native CRT worker ${this.index} has overlapping reads`));
    if (this.stdoutBuffer.length >= bytes) {
      const result = this.stdoutBuffer.subarray(0, bytes);
      this.stdoutBuffer = this.stdoutBuffer.subarray(bytes);
      return Promise.resolve(result);
    }
    return new Promise((resolve, reject) => {
      this.readWaiter = { bytes, resolve, reject };
      this.#flushRead();
    });
  }

  async process(packet, context) {
    this.#ref();
    try {
      if (!(packet?.rgba instanceof Uint8Array)) throw new Error("native CRT requires RGBA bytes");
      const expected = context.width * context.height * 4;
      if (packet.rgba.byteLength !== expected) {
        throw new Error(`native CRT expected ${expected} bytes, got ${packet.rgba.byteLength}`);
      }
      const header = createHeader(packet, context);
      const rgba = Buffer.from(packet.rgba.buffer, packet.rgba.byteOffset, packet.rgba.byteLength);
      await this.#write(header);
      await this.#write(rgba);
      return await this.#readExact(expected);
    } finally {
      this.#unref();
    }
  }

  async close() {
    this.#ref();
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) this.child.stdin.end();
    if (this.child.exitCode == null && this.child.signalCode == null) await once(this.child, "exit");
  }

  kill() {
    try { if (this.child.exitCode == null) this.child.kill("SIGTERM"); } catch {}
  }
}

const clients = Array.from({ length: poolSize }, (_, index) => new NativeClient(index));
const available = [...clients];
const acquireWaiters = [];

const acquire = () => {
  const client = available.shift();
  if (client) return Promise.resolve(client);
  queuedAcquires += 1;
  maxQueuedAcquires = Math.max(maxQueuedAcquires, queuedAcquires);
  return new Promise((resolve) => {
    acquireWaiters.push((resolvedClient) => {
      queuedAcquires -= 1;
      resolve(resolvedClient);
    });
  });
};

const release = (client) => {
  const waiter = acquireWaiters.shift();
  if (waiter) waiter(client);
  else available.push(client);
};

export const processFrame = async (packet, context) => {
  const client = await acquire();
  activeClients += 1;
  maxActiveClients = Math.max(maxActiveClients, activeClients);
  try {
    return await client.process(packet, context);
  } finally {
    activeClients -= 1;
    release(client);
  }
};

export const close = async () => {
  await Promise.all(clients.map((client) => client.close()));
};

export const backendInfo = Object.freeze({
  poolSize,
  get maxActiveClients() { return maxActiveClients; },
  get maxQueuedAcquires() { return maxQueuedAcquires; },
});

process.once("exit", () => {
  for (const client of clients) client.kill();
});

export default processFrame;
