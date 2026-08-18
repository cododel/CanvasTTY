import assert from "node:assert/strict";
import test from "node:test";
import { PluginBrowserOpenBroker } from "../src/main/ipc/PluginBrowserOpenBroker.ts";

function fakeMainWindow() {
  const messages = [];
  return {
    messages,
    isDestroyed: () => false,
    isMinimized: () => false,
    show: () => undefined,
    focus: () => undefined,
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => messages.push({ channel, payload })
    }
  };
}

test("plugin browser broker correlates concurrent renderer acknowledgements", async () => {
  const window = fakeMainWindow();
  const broker = new PluginBrowserOpenBroker(() => window, 100);

  const first = broker.request("demo.plugin", "https://one.example/");
  const second = broker.request("demo.plugin", "https://two.example/");
  assert.equal(window.messages.length, 2);
  assert.notEqual(window.messages[0].payload.requestId, window.messages[1].payload.requestId);

  assert.equal(broker.complete({ requestId: window.messages[1].payload.requestId, ok: true }), true);
  await second;
  assert.equal(broker.complete({ requestId: window.messages[0].payload.requestId, ok: false, error: "Renderer rejected request." }), true);
  await assert.rejects(first, /Renderer rejected request/);
  assert.equal(broker.complete({ requestId: "unknown", ok: true }), false);
});

test("plugin browser broker fails closed when the renderer is missing or does not answer", async () => {
  await assert.rejects(
    new PluginBrowserOpenBroker(() => null, 10).request("demo.plugin", "https://example.com/"),
    /main renderer is unavailable/
  );

  const window = fakeMainWindow();
  const broker = new PluginBrowserOpenBroker(() => window, 10);
  await assert.rejects(broker.request("demo.plugin", "https://example.com/"), /timed out/);
  assert.equal(broker.pendingCount(), 0);
});
