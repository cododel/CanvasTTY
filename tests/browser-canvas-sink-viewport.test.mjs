import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserCanvasSinkViewportController,
  browserCanvasDeviceEmulationParameters
} from "../src/main/services/browser/BrowserCanvasSinkViewport.ts";

function harness() {
  const calls = [];
  const contents = {
    isDestroyed() {
      return false;
    },
    enableDeviceEmulation(parameters) {
      calls.push({ type: "enable", parameters });
    },
    disableDeviceEmulation() {
      calls.push({ type: "disable" });
    }
  };
  return { calls, contents };
}

test("native sink device emulation preserves the original logical viewport", () => {
  assert.deepEqual(browserCanvasDeviceEmulationParameters({ width: 830.4, height: 433.2 }), {
    screenPosition: "desktop",
    screenSize: { width: 830, height: 433 },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: { width: 830, height: 433 },
    scale: 1
  });
  assert.deepEqual(browserCanvasDeviceEmulationParameters({ width: 0, height: -2 }), {
    screenPosition: "desktop",
    screenSize: { width: 1, height: 1 },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: { width: 1, height: 1 },
    scale: 1
  });
});

test("native sink preserves once and restores device emulation once", () => {
  const state = harness();
  const controller = new BrowserCanvasSinkViewportController(state.contents);

  assert.equal(controller.preserve({ width: 830, height: 433 }), true);
  assert.equal(controller.preserve({ width: 400, height: 300 }), true);
  assert.equal(controller.restore(), true);
  assert.equal(controller.restore(), true);

  assert.deepEqual(state.calls, [
    { type: "enable", parameters: browserCanvasDeviceEmulationParameters({ width: 830, height: 433 }) },
    { type: "disable" }
  ]);
});

test("failed device emulation does not arm a native sink and may be retried", () => {
  let attempts = 0;
  const contents = {
    isDestroyed: () => false,
    enableDeviceEmulation() {
      attempts += 1;
      if (attempts === 1) throw new Error("unsupported");
    },
    disableDeviceEmulation() {}
  };
  const controller = new BrowserCanvasSinkViewportController(contents);

  assert.equal(controller.preserve({ width: 830, height: 433 }), false);
  assert.equal(controller.preserve({ width: 830, height: 433 }), true);
  assert.equal(attempts, 2);
});

test("disposing an active native sink restores device emulation", () => {
  const state = harness();
  const controller = new BrowserCanvasSinkViewportController(state.contents);

  assert.equal(controller.preserve({ width: 830, height: 433 }), true);
  controller.dispose();
  controller.dispose();

  assert.deepEqual(state.calls.map(({ type }) => type), ["enable", "disable"]);
  assert.equal(controller.preserve({ width: 830, height: 433 }), false);
});
