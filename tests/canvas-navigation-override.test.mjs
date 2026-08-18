import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  CanvasNavigationInputController,
  CanvasNavigationOverrideTracker,
  shouldPreventCanvasNavigationInput
} from "../src/main/services/CanvasNavigationOverride.ts";

const input = (type, key, modifiers = {}) => ({
  type,
  key,
  code: key === " " ? "Space" : key,
  alt: false,
  control: false,
  meta: false,
  shift: false,
  ...modifiers
});

test("modifier-only override activates immediately and permits extra zoom modifiers", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt");
  assert.deepEqual(tracker.update(input("keyDown", "Alt", { alt: true })), {
    active: true,
    changed: true,
    reserved: true
  });
  assert.deepEqual(tracker.update(input("keyDown", "Meta", { alt: true, meta: true })), {
    active: true,
    changed: false,
    reserved: false
  });
  assert.deepEqual(tracker.update(input("keyUp", "Alt", { meta: true })), {
    active: false,
    changed: true,
    reserved: true
  });
});

test("owned modifiers keep their keyup observable while owned ordinary keys are prevented", () => {
  assert.equal(shouldPreventCanvasNavigationInput(input("keyDown", "Alt"), {
    active: true,
    changed: true,
    reserved: true
  }), false);
  assert.equal(shouldPreventCanvasNavigationInput(input("keyDown", " "), {
    active: true,
    changed: true,
    reserved: true
  }), true);
});

test("controller tracks wheel-only and full overrides independently without hiding modifier keyup", () => {
  const contents = new EventEmitter();
  const ignored = [];
  contents.isDestroyed = () => false;
  contents.setIgnoreMenuShortcuts = (active) => ignored.push(active);
  const activeStates = [];
  const controller = new CanvasNavigationInputController({
    wheelBinding: "Meta",
    navigationBinding: "Alt"
  }, (state) => activeStates.push(state));
  controller.attach(contents);

  let prevented = false;
  contents.emit("before-input-event", { preventDefault: () => { prevented = true; } }, input(
    "keyDown",
    "Meta",
    { meta: true }
  ));
  assert.equal(prevented, false);
  assert.deepEqual(ignored, []);

  contents.emit("before-input-event", { preventDefault: () => { prevented = true; } }, input(
    "keyDown",
    "h",
    { code: "KeyH", meta: true }
  ));
  assert.equal(prevented, false);

  contents.emit("before-input-event", { preventDefault: () => { prevented = true; } }, input(
    "keyUp",
    "Meta"
  ));
  assert.equal(prevented, false);
  assert.deepEqual(ignored, []);
  assert.deepEqual(activeStates, [
    { wheelActive: true, navigationActive: false },
    { wheelActive: false, navigationActive: false }
  ]);
});

test("standalone Alt and ordinary-key chords retain menu shortcut capture", () => {
  const contents = new EventEmitter();
  const ignored = [];
  contents.isDestroyed = () => false;
  contents.setIgnoreMenuShortcuts = (active) => ignored.push(active);
  const controller = new CanvasNavigationInputController({
    wheelBinding: null,
    navigationBinding: "Alt"
  }, () => undefined);
  controller.attach(contents);

  contents.emit("before-input-event", { preventDefault: () => undefined }, input(
    "keyDown",
    "Alt",
    { alt: true }
  ));
  contents.emit("before-input-event", { preventDefault: () => undefined }, input("keyUp", "Alt"));
  assert.deepEqual(ignored, [true, false]);

  controller.setBindings({ wheelBinding: "Meta+Space", navigationBinding: null });
  contents.emit("before-input-event", { preventDefault: () => undefined }, input(
    "keyDown",
    "Meta",
    { meta: true }
  ));
  contents.emit("before-input-event", { preventDefault: () => undefined }, input(
    "keyDown",
    " ",
    { meta: true }
  ));
  contents.emit("before-input-event", { preventDefault: () => undefined }, input("keyUp", "Meta"));
  assert.deepEqual(ignored, [true, false, true, false]);
});

test("modifier-only Meta full override does not swallow ordinary Command shortcuts", () => {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.setIgnoreMenuShortcuts = () => undefined;
  const controller = new CanvasNavigationInputController({
    wheelBinding: null,
    navigationBinding: "Meta"
  }, () => undefined);
  controller.attach(contents);

  let prevented = false;
  contents.emit("before-input-event", { preventDefault: () => { prevented = true; } }, input(
    "keyDown",
    "Meta",
    { meta: true }
  ));
  assert.equal(controller.active, true);
  assert.equal(prevented, false);
  contents.emit("before-input-event", { preventDefault: () => { prevented = true; } }, input(
    "keyDown",
    "c",
    { code: "KeyC", meta: true }
  ));
  assert.equal(prevented, false);
});

test("full override remains independent when both bindings are held", () => {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.setIgnoreMenuShortcuts = () => undefined;
  const states = [];
  const controller = new CanvasNavigationInputController({
    wheelBinding: "Meta",
    navigationBinding: "Alt"
  }, (state) => states.push(state));
  controller.attach(contents);

  contents.emit("before-input-event", { preventDefault: () => undefined }, input(
    "keyDown",
    "Meta",
    { meta: true }
  ));
  contents.emit("before-input-event", { preventDefault: () => undefined }, input(
    "keyDown",
    "Alt",
    { meta: true, alt: true }
  ));
  contents.emit("before-input-event", { preventDefault: () => undefined }, input(
    "keyUp",
    "Meta",
    { alt: true }
  ));

  assert.deepEqual(states, [
    { wheelActive: true, navigationActive: false },
    { wheelActive: true, navigationActive: true },
    { wheelActive: false, navigationActive: true }
  ]);
  assert.equal(controller.wheelActive, false);
  assert.equal(controller.active, true);
});

test("identical bindings activate both modes and full navigation remains available", () => {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.setIgnoreMenuShortcuts = () => undefined;
  const states = [];
  const controller = new CanvasNavigationInputController({
    wheelBinding: "Alt",
    navigationBinding: "Alt"
  }, (state) => states.push(state));
  controller.attach(contents);
  contents.emit("before-input-event", { preventDefault: () => undefined }, input(
    "keyDown",
    "Alt",
    { alt: true }
  ));
  assert.deepEqual(states, [{ wheelActive: true, navigationActive: true }]);
  assert.equal(controller.wheelActive, true);
  assert.equal(controller.active, true);
  controller.reset();
  assert.deepEqual(states.at(-1), { wheelActive: false, navigationActive: false });
});

test("modifier keyup clears the released modifier even when Electron keeps it in the snapshot", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt");
  tracker.update(input("keyDown", "Alt", { alt: true }));
  assert.deepEqual(tracker.update(input("keyUp", "Alt", { alt: true })), {
    active: false,
    changed: true,
    reserved: true
  });
});

test("modifier-key chord reserves its prefix and activates only when complete", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt+Space");
  assert.deepEqual(tracker.update(input("keyDown", "Alt", { alt: true })), {
    active: false,
    changed: false,
    reserved: true
  });
  assert.deepEqual(tracker.update(input("keyDown", " ", { alt: true })), {
    active: true,
    changed: true,
    reserved: true
  });
  assert.deepEqual(tracker.update(input("keyUp", " ", { alt: true })), {
    active: false,
    changed: true,
    reserved: true
  });
});

test("modifier-key chord does not reserve or arm its ordinary key without the modifiers", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt+Space");
  assert.deepEqual(tracker.update(input("keyDown", " ")), {
    active: false,
    changed: false,
    reserved: false
  });
  assert.deepEqual(tracker.update(input("keyDown", "Alt", { alt: true })), {
    active: false,
    changed: false,
    reserved: true
  });
  assert.deepEqual(tracker.update(input("keyUp", " ", { alt: true })), {
    active: false,
    changed: false,
    reserved: false
  });
});

test("an owned ordinary chord key remains reserved through keyup after modifier release", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt+Space");
  tracker.update(input("keyDown", "Alt", { alt: true }));
  tracker.update(input("keyDown", " ", { alt: true }));
  tracker.update(input("keyUp", "Alt"));
  assert.deepEqual(tracker.update(input("keyUp", " ")), {
    active: false,
    changed: false,
    reserved: true
  });
});

test("ordinary chord keys use the physical key code across layouts", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt+K");
  tracker.update(input("keyDown", "Alt", { alt: true }));
  assert.deepEqual(tracker.update(input("keyDown", "˚", { code: "KeyK", alt: true })), {
    active: true,
    changed: true,
    reserved: true
  });
});

test("blur reset and shortcut capture suspension clear active state", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt");
  tracker.update(input("keyDown", "Alt", { alt: true }));
  assert.deepEqual(tracker.reset(), { active: false, changed: true, reserved: false });

  tracker.setSuspended(true);
  assert.deepEqual(tracker.update(input("keyDown", "Alt", { alt: true })), {
    active: false,
    changed: false,
    reserved: false
  });
  tracker.setSuspended(false);
  assert.equal(tracker.active, false);
});

test("changing a binding resets pressed state instead of activating it retroactively", () => {
  const tracker = new CanvasNavigationOverrideTracker("Alt");
  tracker.update(input("keyDown", "Alt", { alt: true }));
  assert.deepEqual(tracker.setBinding("Ctrl+Alt"), {
    active: false,
    changed: true,
    reserved: false
  });
  assert.equal(tracker.active, false);
});
