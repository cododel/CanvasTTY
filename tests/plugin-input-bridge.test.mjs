import assert from "node:assert/strict";
import test from "node:test";
import {
  pluginCanvasFocusInput,
  pluginCanvasWheelInput
} from "../src/renderer/src/features/plugins/pluginInputBridge.ts";

const frame = {
  left: 100,
  top: 50,
  width: 600,
  height: 400,
  layoutWidth: 600,
  layoutHeight: 400
};
const message = {
  source: "canvastty-plugin",
  type: "canvas-wheel",
  clientX: 20,
  clientY: 30,
  deltaX: 2,
  deltaY: -3,
  deltaMode: 1,
  ctrlKey: true,
  metaKey: false,
  altKey: true,
  shiftKey: false
};

test("validates and converts plugin wheel relay data to bounded host pixels", () => {
  assert.deepEqual(pluginCanvasWheelInput(message, frame), {
    clientX: 120,
    clientY: 80,
    deltaX: 32,
    deltaY: -48,
    ctrlKey: true,
    metaKey: false,
    altKey: true,
    shiftKey: false
  });
  assert.deepEqual(pluginCanvasWheelInput({ ...message, deltaX: 10_000, deltaMode: 0 }, frame), {
    clientX: 120,
    clientY: 80,
    deltaX: 1_200,
    deltaY: -3,
    ctrlKey: true,
    metaKey: false,
    altKey: true,
    shiftKey: false
  });
});

test("rejects spoofable malformed or out-of-frame plugin messages", () => {
  assert.equal(pluginCanvasWheelInput({ ...message, source: "plugin" }, frame), null);
  assert.equal(pluginCanvasWheelInput({ ...message, clientX: 700 }, frame), null);
  assert.equal(pluginCanvasWheelInput({ ...message, deltaY: Number.NaN }, frame), null);
  assert.equal(pluginCanvasWheelInput({ ...message, ctrlKey: "yes" }, frame), null);
  assert.equal(pluginCanvasWheelInput({ ...message, deltaMode: 3 }, frame), null);
  assert.equal(pluginCanvasWheelInput({ ...message, injected: true }, frame), null);
});

test("maps iframe layout coordinates through the canvas visual transform", () => {
  const transformedFrame = {
    left: 100,
    top: 50,
    width: 300,
    height: 200,
    layoutWidth: 600,
    layoutHeight: 400
  };
  assert.deepEqual(pluginCanvasWheelInput({
    ...message,
    clientX: 500,
    clientY: 300,
    deltaMode: 0
  }, transformedFrame), {
    clientX: 350,
    clientY: 200,
    deltaX: 2,
    deltaY: -3,
    ctrlKey: true,
    metaKey: false,
    altKey: true,
    shiftKey: false
  });
});

test("accepts only exact plugin focus and hover bridge messages", () => {
  assert.deepEqual(pluginCanvasFocusInput({
    source: "canvastty-plugin",
    type: "canvas-focus"
  }), { type: "focus" });
  assert.deepEqual(pluginCanvasFocusInput({
    source: "canvastty-plugin",
    type: "canvas-hover",
    active: true
  }), { type: "hover", active: true });
  assert.deepEqual(pluginCanvasFocusInput({
    source: "canvastty-plugin",
    type: "canvas-hover",
    active: false
  }), { type: "hover", active: false });
  assert.equal(pluginCanvasFocusInput({
    source: "canvastty-plugin",
    type: "canvas-focus",
    injected: true
  }), null);
  assert.equal(pluginCanvasFocusInput({
    source: "canvastty-plugin",
    type: "canvas-hover",
    active: "yes"
  }), null);
});
