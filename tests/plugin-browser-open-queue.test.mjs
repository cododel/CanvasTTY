import assert from "node:assert/strict";
import test from "node:test";
import { PluginBrowserOpenQueue } from "../src/renderer/src/features/plugins/PluginBrowserOpenQueue.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("plugin browser queue serializes concurrent opens and recovers after a rejection", async () => {
  const queue = new PluginBrowserOpenQueue();
  const gate = deferred();
  const events = [];

  const first = queue.enqueue(async () => {
    events.push("first:start");
    await gate.promise;
    events.push("first:end");
    return "first";
  });
  const failed = queue.enqueue(async () => {
    events.push("failed:start");
    throw new Error("open failed");
  });
  const third = queue.enqueue(async () => {
    events.push("third:start");
    return "third";
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["first:start"]);
  gate.resolve();
  assert.equal(await first, "first");
  await assert.rejects(failed, /open failed/);
  assert.equal(await third, "third");
  assert.deepEqual(events, ["first:start", "first:end", "failed:start", "third:start"]);
});
