import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCanvasWheelBinding,
  canvasOverrideBindingConflicts,
  isCanvasNavigationBindingActive,
  normalizeCanvasOverrideBinding,
  normalizeCanvasNavigationInputKey,
  parseCanvasNavigationBinding,
  shouldCanvasOwnWheel
} from "../src/shared/canvasNavigation.ts";

test("accepts modifier-only and modifier-based chords but rejects bare keys", () => {
  assert.deepEqual(parseCanvasNavigationBinding("Alt"), { modifiers: ["Alt"], key: null });
  assert.deepEqual(parseCanvasNavigationBinding("Alt+Ctrl+Space"), {
    modifiers: ["Ctrl", "Alt"],
    key: "Space"
  });
  assert.equal(parseCanvasNavigationBinding("Space"), null);
});

test("wheel capture modes keep Off, On, Key, and full navigation ownership distinct", () => {
  assert.equal(activeCanvasWheelBinding("off", "Meta"), null);
  assert.equal(activeCanvasWheelBinding("always", "Meta"), null);
  assert.equal(activeCanvasWheelBinding("key", "Meta"), "Meta");
  const ownership = (captureMode, wheelOverrideActive, navigationOverrideActive) => shouldCanvasOwnWheel({
    overFocusedWidget: true,
    captureMode,
    wheelOverrideActive,
    navigationOverrideActive
  });
  assert.equal(ownership("off", true, false), false);
  assert.equal(ownership("always", false, false), true);
  assert.equal(ownership("key", false, false), false);
  assert.equal(ownership("key", true, false), true);
  assert.equal(ownership("off", false, true), true);
});

test("normalizes order and accepts the platform zoom modifier by itself", () => {
  assert.equal(normalizeCanvasOverrideBinding("Alt+Ctrl"), "Ctrl+Alt");
  assert.equal(normalizeCanvasOverrideBinding("Meta"), "Meta");
  assert.equal(normalizeCanvasOverrideBinding("Ctrl"), "Ctrl");
  assert.equal(normalizeCanvasOverrideBinding("Ctrl+Alt"), "Ctrl+Alt");
});

test("extra modifiers keep a configured override active", () => {
  assert.equal(isCanvasNavigationBindingActive({
    altKey: true,
    ctrlKey: false,
    metaKey: true,
    shiftKey: false
  }, "Alt"), true);
  assert.equal(isCanvasNavigationBindingActive({
    altKey: true,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    pressedKeys: new Set(["Space"])
  }, "Alt+Space"), true);
});

test("modifier-only overrides coexist with action shortcuts while ordinary chords conflict", () => {
  assert.equal(canvasOverrideBindingConflicts("Alt", "Alt+R"), false);
  assert.equal(canvasOverrideBindingConflicts("Alt+K", "Ctrl+Alt+K"), true);
  assert.equal(canvasOverrideBindingConflicts("Alt+K", "Alt+R"), false);
  assert.equal(canvasOverrideBindingConflicts("Meta", "Meta+H"), false);
  assert.equal(canvasOverrideBindingConflicts("Meta+Space", "Meta+Space"), true);
  assert.equal(normalizeCanvasOverrideBinding("Alt", ["Alt+R"]), "Alt");
  assert.equal(normalizeCanvasOverrideBinding("Meta+H", ["Meta+H"]), null);
});

test("normalizes ordinary chord keys by physical code across keyboard layouts", () => {
  assert.equal(normalizeCanvasNavigationInputKey("ф", "KeyA"), "A");
  assert.equal(normalizeCanvasNavigationInputKey("˚", "KeyK"), "K");
  assert.equal(normalizeCanvasNavigationInputKey(" ", "Space"), "Space");
});
