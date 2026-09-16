import assert from "node:assert/strict";
import test from "node:test";

import { OrderedFrameSink } from "../.agents/skills/framewright/scripts/ordered-frame-sink.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("writes out-of-order submissions in strict frame order", async () => {
  const writes = [];
  const sink = new OrderedFrameSink({
    start: 0,
    write: async (frame, buffer) => writes.push([frame, buffer]),
  });

  const frame2 = sink.submit(2, "c");
  await tick();
  assert.deepEqual(writes, []);

  const frame0 = sink.submit(0, "a");
  await frame0;
  assert.deepEqual(writes, [[0, "a"]]);

  const frame1 = sink.submit(1, "b");
  await Promise.all([frame1, frame2]);
  assert.deepEqual(writes, [[0, "a"], [1, "b"], [2, "c"]]);
  await sink.finish(3);
});

test("fail rejects buffered acknowledgements", async () => {
  const sink = new OrderedFrameSink({ start: 0, write: async () => {} });
  const frame1 = sink.submit(1, Buffer.from("later"));
  sink.fail(new Error("encoder died"));

  await assert.rejects(frame1, /encoder died/);
  await assert.rejects(sink.submit(0, Buffer.from("now")), /encoder died/);
  await assert.rejects(sink.finish(2), /encoder died/);
});

test("write failure rejects current and buffered frames", async () => {
  const sink = new OrderedFrameSink({
    start: 0,
    write: async (frame) => {
      if (frame === 0) throw new Error("pipe closed");
    },
  });

  const frame1 = sink.submit(1, Buffer.alloc(1));
  const frame0 = sink.submit(0, Buffer.alloc(1));
  await assert.rejects(frame0, /pipe closed/);
  await assert.rejects(frame1, /pipe closed/);
  assert.match(sink.failed.message, /pipe closed/);
});

test("finish detects a missing frame", async () => {
  const sink = new OrderedFrameSink({ start: 4, write: async () => {} });
  await assert.rejects(sink.finish(5), /incomplete/);
});
