import assert from "node:assert/strict";
import test from "node:test";
import {
  clipBrowserViewportBounds,
  normalizeBrowserViewportBounds
} from "../src/main/services/browser/BrowserViewport.ts";

test("browser viewport expands fractional edges instead of exposing compositor gaps", () => {
  assert.deepEqual(normalizeBrowserViewportBounds({
    x: 10.4,
    y: 20.6,
    width: 100.2,
    height: 50.1,
    surface: "native",
    canvasScale: 0.92,
    showAgentPresence: true
  }), {
    x: 10,
    y: 20,
    width: 101,
    height: 51,
    surface: "native",
    canvasScale: 0.92,
    showAgentPresence: true
  });
});

test("browser viewport rejects invalid geometry and clamps negative sizes", () => {
  assert.equal(normalizeBrowserViewportBounds(null), null);
  assert.equal(normalizeBrowserViewportBounds({ x: 0, y: 0, width: Number.NaN, height: 10 }), null);
  assert.deepEqual(normalizeBrowserViewportBounds({
    x: -2.2,
    y: 3.8,
    width: -20,
    height: -10,
    surface: "hidden"
  }), {
    x: -3,
    y: 3,
    width: 0,
    height: 0,
    surface: "hidden",
    showAgentPresence: false
  });
});

test("browser viewport keeps page scaling inside Chromium's supported range", () => {
  assert.equal(normalizeBrowserViewportBounds({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    surface: "placeholder",
    canvasScale: 0.2
  })?.canvasScale, 0.5);
  assert.equal(normalizeBrowserViewportBounds({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    surface: "native",
    canvasScale: 8
  })?.canvasScale, 3);
});

test("browser viewport rejects invalid surface state", () => {
  assert.equal(normalizeBrowserViewportBounds({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    surface: "invalid"
  }), null);
});

test("browser viewport stays below trusted window chrome when the card leaves the workspace", () => {
  const bounds = normalizeBrowserViewportBounds({
    x: 489,
    y: -20,
    width: 540,
    height: 420,
    surface: "native",
    clipBounds: { x: 0, y: 44, width: 786, height: 623 }
  });

  assert.ok(bounds);
  assert.deepEqual(clipBrowserViewportBounds(bounds, { width: 786, height: 667 }), {
    x: 489,
    y: 44,
    width: 297,
    height: 356
  });
});

test("browser viewport contracts fractional trusted clip edges and rejects malformed clips", () => {
  assert.deepEqual(normalizeBrowserViewportBounds({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    surface: "native",
    clipBounds: { x: 0.2, y: 43.2, width: 785.6, height: 556.8 }
  })?.clipBounds, {
    x: 1,
    y: 44,
    width: 784,
    height: 556
  });
  assert.equal(normalizeBrowserViewportBounds({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    surface: "native",
    clipBounds: { x: 0, y: Number.NaN, width: 800, height: 556 }
  }), null);
});
