import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasWheelIntent,
  normalizeCanvasWheelDeltas,
  shouldCanvasOwnWheel
} from "../src/shared/canvasNavigation.ts";

const settings = {
  invertCanvasWheel: false,
  useScrollWheelToZoom: false,
  zoomSensitivity: "normal"
};

test("normalizes pixel, line, and page wheel deltas on both axes", () => {
  assert.deepEqual(normalizeCanvasWheelDeltas(2, -3, 0, { width: 800, height: 600 }), {
    deltaX: 2,
    deltaY: -3
  });
  assert.deepEqual(normalizeCanvasWheelDeltas(2, -3, 1, { width: 800, height: 600 }), {
    deltaX: 32,
    deltaY: -48
  });
  assert.deepEqual(normalizeCanvasWheelDeltas(2, -3, 2, { width: 800, height: 600 }), {
    deltaX: 1_600,
    deltaY: -1_800
  });
});

test("ordinary scroll pans in screen space and inversion flips both axes", () => {
  assert.deepEqual(
    canvasWheelIntent({ deltaX: 12.5, deltaY: -8 }, { ctrlKey: false, metaKey: false }, settings),
    { kind: "pan", deltaX: 12.5, deltaY: -8 }
  );
  assert.deepEqual(
    canvasWheelIntent(
      { deltaX: 12.5, deltaY: -8 },
      { ctrlKey: false, metaKey: false },
      { ...settings, invertCanvasWheel: true }
    ),
    { kind: "pan", deltaX: -12.5, deltaY: 8 }
  );
});

test("plain wheel zoom retains legacy sensitivity and direction", () => {
  const intent = canvasWheelIntent(
    { deltaX: 40, deltaY: 100 },
    { ctrlKey: false, metaKey: false },
    { ...settings, useScrollWheelToZoom: true }
  );
  assert.equal(intent.kind, "zoom");
  assert.equal(intent.source, "wheel");
  assert.ok(Math.abs(intent.factor - Math.exp(-0.12)) < 1e-12);
});

test("ctrl or meta wheel uses clamped pinch mapping independently of wheel preferences", () => {
  const zoomSettings = {
    invertCanvasWheel: true,
    useScrollWheelToZoom: true,
    zoomSensitivity: "fast"
  };
  assert.deepEqual(
    canvasWheelIntent({ deltaX: 0, deltaY: 100 }, { ctrlKey: true, metaKey: false }, zoomSettings),
    { kind: "zoom", factor: 0.75, source: "modifier" }
  );
  const meta = canvasWheelIntent(
    { deltaX: 0, deltaY: -10 },
    { ctrlKey: false, metaKey: true },
    zoomSettings
  );
  assert.equal(meta.kind, "zoom");
  assert.ok(Math.abs(meta.factor - Math.exp(0.1)) < 1e-12);
});

test("a wheel override can route modifier scroll to focal zoom over a widget", () => {
  assert.equal(shouldCanvasOwnWheel({
    overFocusedWidget: true,
    captureMode: "key",
    wheelOverrideActive: true,
    navigationOverrideActive: false
  }), true);
  assert.deepEqual(
    canvasWheelIntent(
      { deltaX: 0, deltaY: 100 },
      { ctrlKey: false, metaKey: true },
      settings
    ),
    { kind: "zoom", factor: 0.75, source: "modifier" }
  );
});

test("only the focused input widget interrupts canvas wheel navigation", () => {
  assert.equal(shouldCanvasOwnWheel({
    overFocusedWidget: false,
    captureMode: "off",
    wheelOverrideActive: false,
    navigationOverrideActive: false
  }), true);
  assert.equal(shouldCanvasOwnWheel({
    overFocusedWidget: true,
    captureMode: "off",
    wheelOverrideActive: false,
    navigationOverrideActive: false
  }), false);
  assert.equal(shouldCanvasOwnWheel({
    overFocusedWidget: true,
    captureMode: "off",
    wheelOverrideActive: false,
    navigationOverrideActive: true
  }), true);
  assert.equal(shouldCanvasOwnWheel({
    overFocusedWidget: true,
    captureMode: "always",
    wheelOverrideActive: false,
    navigationOverrideActive: false
  }), true);
  assert.equal(shouldCanvasOwnWheel({
    overFocusedWidget: true,
    captureMode: "key",
    wheelOverrideActive: true,
    navigationOverrideActive: false
  }), true);
});
