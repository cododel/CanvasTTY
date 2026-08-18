import assert from "node:assert/strict";
import test from "node:test";
import {
  browserCanvasWidgetId,
  canvasWidgetFocusAfterClick,
  homeCanvasWidgetId,
  pluginCanvasWidgetId,
  terminalCanvasWidgetId
} from "../src/renderer/src/features/workspace/canvasWidgetFocus.ts";

test("canvas widget ids are stable across each focusable input surface", () => {
  assert.equal(terminalCanvasWidgetId("pty-1"), "terminal:pty-1");
  assert.equal(pluginCanvasWidgetId("canvas-1"), "plugin-canvas:canvas-1");
  assert.equal(homeCanvasWidgetId("core.sessions"), "home:core.sessions");
  assert.equal(browserCanvasWidgetId, "browser");
});

test("only a click outside every widget clears logical input focus", () => {
  assert.equal(canvasWidgetFocusAfterClick("terminal:one", {
    isWidget: true,
    focusableWidgetId: "browser"
  }), "browser");
  assert.equal(canvasWidgetFocusAfterClick("terminal:one", {
    isWidget: true,
    focusableWidgetId: null
  }), "terminal:one");
  assert.equal(canvasWidgetFocusAfterClick("terminal:one", {
    isWidget: false,
    focusableWidgetId: null
  }), null);
});
