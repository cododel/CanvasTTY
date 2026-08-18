import assert from "node:assert/strict";
import test from "node:test";
import {
  ZOOM_SENSITIVITY_FACTORS,
  wheelZoomFactor
} from "../src/shared/canvasNavigation.ts";

test("normal sensitivity keeps the historical wheel step", () => {
  assert.ok(Math.abs(wheelZoomFactor(100, "normal") - Math.exp(-0.12)) < 1e-12);
});

test("fast sensitivity doubles the step and slow halves it", () => {
  assert.ok(Math.abs(wheelZoomFactor(100, "fast") - Math.exp(-0.24)) < 1e-12);
  assert.ok(Math.abs(wheelZoomFactor(100, "slow") - Math.exp(-0.06)) < 1e-12);
});

test("scrolling up zooms in at every sensitivity", () => {
  for (const sensitivity of Object.keys(ZOOM_SENSITIVITY_FACTORS)) {
    assert.ok(wheelZoomFactor(-100, sensitivity) > 1, sensitivity);
  }
});

test("a resting wheel changes nothing", () => {
  assert.equal(wheelZoomFactor(0, "fast"), 1);
});

test("higher sensitivity zooms out faster for the same delta", () => {
  const delta = 120;
  assert.ok(wheelZoomFactor(delta, "fast") < wheelZoomFactor(delta, "normal"));
  assert.ok(wheelZoomFactor(delta, "normal") < wheelZoomFactor(delta, "slow"));
});
