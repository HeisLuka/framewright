const asError = (value) => (
  value instanceof Error
    ? value
    : new Error(String(value || "ordered frame sink failed"))
);

/**
 * Ordered acknowledgement queue for parallel frame producers.
 *
 * A producer receives its acknowledgement only after that frame has actually
 * been written. When producers submit at most one frame at a time this gives
 * the raw renderer natural backpressure and bounds out-of-order memory by the
 * worker count rather than the total video length.
 */
export class OrderedFrameSink {
  #write;
  #next;
  #pending = new Map();
  #flushing = null;
  #failed = null;
  #closed = false;

  constructor({ start = 0, write } = {}) {
    if (!Number.isInteger(start) || start < 0) {
      throw new Error("start must be a non-negative integer");
    }
    if (typeof write !== "function") {
      throw new Error("write callback is required");
    }
    this.#next = start;
    this.#write = write;
  }

  get nextFrame() { return this.#next; }
  get pendingFrames() { return this.#pending.size; }
  get failed() { return this.#failed; }

  submit(frame, buffer) {
    if (this.#failed) return Promise.reject(this.#failed);
    if (this.#closed) return Promise.reject(new Error("ordered frame sink is closed"));
    if (!Number.isInteger(frame) || frame < 0) {
      return Promise.reject(new Error("frame must be a non-negative integer"));
    }
    if (frame < this.#next || this.#pending.has(frame)) {
      return Promise.reject(new Error(`duplicate or stale frame ${frame}`));
    }

    let resolveAck;
    let rejectAck;
    const acknowledgement = new Promise((resolve, reject) => {
      resolveAck = resolve;
      rejectAck = reject;
    });
    this.#pending.set(frame, { buffer, resolveAck, rejectAck });
    this.#scheduleFlush();
    return acknowledgement;
  }

  fail(error) {
    if (this.#failed) return this.#failed;
    const failure = asError(error);
    this.#failed = failure;
    for (const item of this.#pending.values()) item.rejectAck(failure);
    this.#pending.clear();
    return failure;
  }

  async finish(expectedEnd) {
    this.#closed = true;
    if (this.#flushing) await this.#flushing;
    if (this.#failed) throw this.#failed;
    if (!Number.isInteger(expectedEnd) || expectedEnd < 0) {
      throw new Error("expectedEnd must be a non-negative integer");
    }
    if (this.#pending.size || this.#next !== expectedEnd) {
      throw new Error(
        `ordered frame sink incomplete: next=${this.#next} expectedEnd=${expectedEnd} pending=${this.#pending.size}`,
      );
    }
  }

  #scheduleFlush() {
    if (this.#flushing || this.#failed || !this.#pending.has(this.#next)) return;
    this.#flushing = this.#flush()
      .catch((error) => {
        this.fail(error);
      })
      .finally(() => {
        this.#flushing = null;
        if (!this.#failed && this.#pending.has(this.#next)) this.#scheduleFlush();
      });
  }

  async #flush() {
    while (!this.#failed && this.#pending.has(this.#next)) {
      const frame = this.#next;
      const item = this.#pending.get(frame);
      this.#pending.delete(frame);
      try {
        await this.#write(frame, item.buffer);
      } catch (error) {
        const failure = asError(error);
        item.rejectAck(failure);
        throw failure;
      }
      this.#next += 1;
      item.resolveAck();
    }
  }
}
