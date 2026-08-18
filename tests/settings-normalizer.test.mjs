import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeHomeGridSize,
  normalizeHomeLayout,
  normalizeSettings,
  SettingsStore
} from "../src/main/services/SettingsStore.ts";

const fallback = {
  locale: "en",
  palette: "sage",
  pattern: "dots",
  snapToGrid: true,
  invertTerminalWheel: true,
  invertCanvasWheel: false,
  edgePan: true,
  edgePanSpeed: "normal",
  zoomSensitivity: "normal",
  canvasWheelCaptureMode: "key",
  useScrollWheelToZoom: false,
  canvasWheelOverride: "Meta",
  canvasNavigationOverride: "Alt",
  focusActivation: "off",
  hoverFocus: false,
  hoverFocusSpeed: "normal",
  showShortcutHints: true,
  shortcuts: { home: "Home", renameWindow: "F2" },
  mediaPath: null,
  mediaFit: "cover",
  lastDirectory: "/",
  acknowledgedDangerousProfiles: [],
  homeGridSize: { columns: 16, rows: 12 },
  homeLayout: [
    { widgetId: "core.clock", column: 0, row: 0, columnSpan: 10, rowSpan: 6 },
    { widgetId: "core.settings", column: 10, row: 6, columnSpan: 2, rowSpan: 2 }
  ],
  pluginCanvas: [],
  browserCanvas: null,
  browserAgentAccess: true,
  browserShowAgentPresence: true,
  browserRestoreTabs: true
};

test("keeps valid wheel, edge pan, zoom, and focus values", () => {
  const normalized = normalizeSettings(
    {
      invertTerminalWheel: false,
      invertCanvasWheel: true,
      edgePan: false,
      edgePanSpeed: "fast",
      zoomSensitivity: "slow",
      canvasWheelCaptureMode: "always",
      hoverFocus: true,
      hoverFocusSpeed: "fast"
    },
    fallback
  );
  assert.equal(normalized.invertTerminalWheel, false);
  assert.equal(normalized.invertCanvasWheel, true);
  assert.equal(normalized.edgePan, false);
  assert.equal(normalized.edgePanSpeed, "fast");
  assert.equal(normalized.zoomSensitivity, "slow");
  assert.equal(normalized.canvasWheelCaptureMode, "always");
  assert.equal(normalized.hoverFocus, true);
  assert.equal(normalized.hoverFocusSpeed, "fast");
});

test("falls back when edge pan and zoom values are garbage", () => {
  const normalized = normalizeSettings(
    { edgePan: "yes", edgePanSpeed: "warp", zoomSensitivity: 11 },
    fallback
  );
  assert.equal(normalized.edgePan, fallback.edgePan);
  assert.equal(normalized.edgePanSpeed, fallback.edgePanSpeed);
  assert.equal(normalized.zoomSensitivity, fallback.zoomSensitivity);
  assert.equal(normalized.canvasWheelCaptureMode, fallback.canvasWheelCaptureMode);
  assert.equal(normalized.invertTerminalWheel, fallback.invertTerminalWheel);
  assert.equal(normalized.invertCanvasWheel, fallback.invertCanvasWheel);
  assert.equal(normalized.focusActivation, fallback.focusActivation);
  assert.equal(normalized.hoverFocus, fallback.hoverFocus);
  assert.equal(normalized.hoverFocusSpeed, fallback.hoverFocusSpeed);
  assert.equal(normalized.showShortcutHints, fallback.showShortcutHints);
  assert.deepEqual(normalized.shortcuts, fallback.shortcuts);
});

test("older settings files without the new keys inherit defaults", () => {
  const normalized = normalizeSettings({ locale: "ru", snapToGrid: false }, fallback);
  assert.equal(normalized.locale, "ru");
  assert.equal(normalized.snapToGrid, false);
  assert.equal(normalized.edgePan, fallback.edgePan);
  assert.equal(normalized.edgePanSpeed, fallback.edgePanSpeed);
  assert.equal(normalized.zoomSensitivity, fallback.zoomSensitivity);
  assert.equal(normalized.canvasWheelCaptureMode, fallback.canvasWheelCaptureMode);
  assert.equal(normalized.invertTerminalWheel, fallback.invertTerminalWheel);
  assert.equal(normalized.invertCanvasWheel, fallback.invertCanvasWheel);
  assert.equal(normalized.hoverFocus, fallback.hoverFocus);
  assert.equal(normalized.hoverFocusSpeed, fallback.hoverFocusSpeed);
});

test("a non-object candidate yields the fallback wholesale", () => {
  assert.equal(normalizeSettings(null, fallback), fallback);
  assert.equal(normalizeSettings("settings", fallback), fallback);
});

test("fresh installs default to scroll pan and key-gated widget wheel input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvastty-settings-"));
  try {
    const store = new SettingsStore(dir, "en");
    await store.load();
    assert.equal(store.get().edgePan, false);
    assert.equal(store.get().edgePanSpeed, "normal");
    assert.equal(store.get().zoomSensitivity, "normal");
    assert.equal(store.get().canvasWheelCaptureMode, "key");
    assert.equal(store.get().useScrollWheelToZoom, false);
    assert.equal(store.get().canvasWheelOverride, process.platform === "darwin" ? "Meta" : "Ctrl");
    assert.equal(store.get().canvasNavigationOverride, "Alt");
    assert.equal(store.get().invertTerminalWheel, true);
    assert.equal(store.get().invertCanvasWheel, false);
    assert.equal(store.get().focusActivation, "off");
    assert.equal(store.get().hoverFocus, false);
    assert.equal(store.get().hoverFocusSpeed, "normal");
    assert.equal(store.get().showShortcutHints, true);
    assert.deepEqual(store.get().homeGridSize, { columns: 16, rows: 12 });
    assert.equal(store.get().browserCanvas, null);
    assert.equal(store.get().browserAgentAccess, true);
    assert.equal(store.get().browserShowAgentPresence, true);
    assert.equal(store.get().browserRestoreTabs, true);
    assert.deepEqual(store.get().shortcuts, { home: "Home", renameWindow: "F2" });
    const persisted = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(Object.hasOwn(persisted, "zoomOverApplications"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fresh wheel capture binding follows the host platform", async () => {
  const macDir = await mkdtemp(join(tmpdir(), "canvastty-settings-mac-wheel-"));
  const otherDir = await mkdtemp(join(tmpdir(), "canvastty-settings-other-wheel-"));
  try {
    const mac = new SettingsStore(macDir, "en", "darwin");
    const other = new SettingsStore(otherDir, "en", "linux");
    await Promise.all([mac.load(), other.load()]);
    assert.equal(mac.get().canvasWheelOverride, "Meta");
    assert.equal(other.get().canvasWheelOverride, "Ctrl");
  } finally {
    await Promise.all([
      rm(macDir, { recursive: true, force: true }),
      rm(otherDir, { recursive: true, force: true })
    ]);
  }
});

test("existing settings migrate to wheel zoom and preserve legacy widget capture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvastty-settings-migration-"));
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({
      locale: "en",
      zoomOverApplications: false
    }), "utf8");

    const store = new SettingsStore(dir, "en");
    const migrated = await store.load();
    assert.equal(migrated.useScrollWheelToZoom, true);
    assert.equal(migrated.canvasWheelCaptureMode, "off");
    assert.equal(migrated.canvasNavigationOverride, "Alt");
    assert.equal(migrated.canvasWheelOverride, null);

    const persisted = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(persisted.useScrollWheelToZoom, true);
    assert.equal(persisted.zoomOverApplications, false);
    assert.equal(persisted.canvasNavigationOverride, "Alt");
    assert.equal(persisted.canvasWheelOverride, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing settings without the legacy key use key mode and keep the legacy key absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvastty-settings-legacy-wheel-"));
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ locale: "ru" }), "utf8");
    const store = new SettingsStore(dir, "ru");
    const migrated = await store.load();
    assert.equal(migrated.useScrollWheelToZoom, true);
    assert.equal(migrated.canvasWheelCaptureMode, "key");
    assert.equal(migrated.canvasWheelOverride, process.platform === "darwin" ? "Meta" : "Ctrl");

    const persisted = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(Object.hasOwn(persisted, "zoomOverApplications"), false);

    await store.update({ palette: "night" });
    const updated = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(Object.hasOwn(updated, "zoomOverApplications"), false);

    await store.update({ canvasWheelCaptureMode: "always" });
    const explicitlyEnabled = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(explicitlyEnabled.zoomOverApplications, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("migration preserves an explicitly enabled legacy widget capture value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvastty-settings-legacy-wheel-enabled-"));
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({
      locale: "en",
      zoomOverApplications: true
    }), "utf8");

    const store = new SettingsStore(dir, "en");
    const migrated = await store.load();
    assert.equal(migrated.canvasWheelCaptureMode, "always");

    const persisted = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(persisted.zoomOverApplications, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy false with a valid wheel binding migrates to key mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvastty-settings-legacy-wheel-key-"));
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({
      zoomOverApplications: false,
      canvasWheelOverride: "Alt"
    }), "utf8");
    const store = new SettingsStore(dir, "en", "darwin");
    const migrated = await store.load();
    assert.equal(migrated.canvasWheelCaptureMode, "key");
    assert.equal(migrated.canvasWheelOverride, "Alt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selecting Key without a saved binding assigns the platform default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvastty-settings-wheel-key-default-"));
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({
      zoomOverApplications: false,
      canvasWheelOverride: null
    }), "utf8");
    const store = new SettingsStore(dir, "en", "darwin");
    await store.load();
    assert.equal(store.get().canvasWheelCaptureMode, "off");
    await store.update({ canvasWheelCaptureMode: "key" });
    assert.equal(store.get().canvasWheelCaptureMode, "key");
    assert.equal(store.get().canvasWheelOverride, "Meta");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid explicit key mode fails closed without replacing action shortcuts", () => {
  const normalized = normalizeSettings({
    canvasWheelCaptureMode: "key",
    canvasWheelOverride: "Meta+Space",
    shortcuts: { home: "Meta+Space", renameWindow: "F2" }
  }, fallback, "darwin");
  assert.equal(normalized.canvasWheelCaptureMode, "off");
  assert.equal(normalized.canvasWheelOverride, null);
  assert.deepEqual(normalized.shortcuts, { home: "Meta+Space", renameWindow: "F2" });
});

test("mode changes persist the compatible legacy boolean and preserve the hidden binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvastty-settings-wheel-mode-"));
  try {
    const store = new SettingsStore(dir, "en", "darwin");
    await store.load();
    await store.update({ canvasWheelOverride: "Alt" });
    await store.update({ canvasWheelCaptureMode: "off" });
    assert.equal(store.get().canvasWheelOverride, "Alt");
    let persisted = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(persisted.zoomOverApplications, false);

    await store.update({ canvasWheelCaptureMode: "always" });
    assert.equal(store.get().canvasWheelOverride, "Alt");
    persisted = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(persisted.zoomOverApplications, true);

    await store.update({ canvasWheelCaptureMode: "key" });
    assert.equal(store.get().canvasWheelCaptureMode, "key");
    assert.equal(store.get().canvasWheelOverride, "Alt");
    persisted = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(persisted.zoomOverApplications, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizes browser agent access, indicators, and tab restore preferences", () => {
  const disabled = normalizeSettings({
    browserAgentAccess: false,
    browserShowAgentPresence: false,
    browserRestoreTabs: false
  }, fallback);
  assert.equal(disabled.browserAgentAccess, false);
  assert.equal(disabled.browserShowAgentPresence, false);
  assert.equal(disabled.browserRestoreTabs, false);

  const invalid = normalizeSettings({
    browserAgentAccess: "yes",
    browserShowAgentPresence: "sometimes",
    browserRestoreTabs: 1
  }, fallback);
  assert.equal(invalid.browserAgentAccess, true);
  assert.equal(invalid.browserShowAgentPresence, true);
  assert.equal(invalid.browserRestoreTabs, true);
});

test("normalizes the optional built-in browser canvas bounds", () => {
  assert.deepEqual(normalizeSettings({
    browserCanvas: { position: { x: 320, y: -40 }, size: { width: 900, height: 640 } }
  }, fallback).browserCanvas, {
    position: { x: 320, y: -40 }, size: { width: 900, height: 640 }
  });
  assert.deepEqual(normalizeSettings({
    browserCanvas: { position: { x: 0, y: 0 }, size: { width: 20, height: 9_000 } }
  }, fallback).browserCanvas?.size, { width: 560, height: 1_100 });
});

test("preserves plugin canvas bounds down to the manifest minimum floor", () => {
  const normalized = normalizeSettings({
    pluginCanvas: [{
      id: "instance-1",
      pluginId: "com.example.music",
      contributionId: "player",
      title: "Player",
      position: { x: 120, y: 80 },
      size: { width: 120, height: 90 }
    }]
  }, fallback);
  assert.deepEqual(normalized.pluginCanvas[0]?.size, { width: 240, height: 140 });
});

test("normalizes resizable Home boundaries within generous safety limits", () => {
  assert.deepEqual(normalizeHomeGridSize({ columns: 24, rows: 20 }), { columns: 24, rows: 20 });
  assert.deepEqual(normalizeHomeGridSize({ columns: 2, rows: 80 }), { columns: 12, rows: 36 });
  assert.deepEqual(normalizeHomeGridSize({ columns: "wide", rows: 20 }), { columns: 16, rows: 12 });
});

test("valid custom shortcuts survive normalization", () => {
  const normalized = normalizeSettings({
    focusActivation: "double",
    showShortcutHints: false,
    shortcuts: { home: "Ctrl+H", renameWindow: "Ctrl+Shift+R" }
  }, fallback);
  assert.equal(normalized.focusActivation, "double");
  assert.equal(normalized.showShortcutHints, false);
  assert.deepEqual(normalized.shortcuts, { home: "Ctrl+H", renameWindow: "Ctrl+Shift+R" });
});

test("conflicting or malformed shortcuts fall back together", () => {
  assert.deepEqual(
    normalizeSettings({ shortcuts: { home: "F2", renameWindow: "F2" } }, fallback).shortcuts,
    fallback.shortcuts
  );
  assert.deepEqual(
    normalizeSettings({ shortcuts: { home: "???", renameWindow: "F2" } }, fallback).shortcuts,
    fallback.shortcuts
  );
});

test("normalization preserves action shortcuts and allows modifier-only navigation overrides", () => {
  const conflict = normalizeSettings({
    shortcuts: { home: "Alt+H", renameWindow: "F2" },
    canvasNavigationOverride: "Alt"
  }, fallback, "darwin");
  assert.deepEqual(conflict.shortcuts, { home: "Alt+H", renameWindow: "F2" });
  assert.equal(conflict.canvasNavigationOverride, "Alt");

  const reserved = normalizeSettings({ canvasNavigationOverride: "Meta" }, fallback, "darwin");
  assert.equal(reserved.canvasNavigationOverride, "Meta");
  assert.equal(normalizeSettings({ canvasNavigationOverride: null }, fallback).canvasNavigationOverride, null);

  const migratedConflict = normalizeSettings({
    shortcuts: { home: "Alt+H", renameWindow: "F2" }
  }, fallback, "darwin");
  assert.deepEqual(migratedConflict.shortcuts, { home: "Alt+H", renameWindow: "F2" });
  assert.equal(migratedConflict.canvasNavigationOverride, "Alt");
});

test("both overrides accept zoom modifiers without swallowing ordinary shortcuts", () => {
  const normalized = normalizeSettings({
    shortcuts: { home: "Meta+H", renameWindow: "F2" },
    canvasWheelOverride: "Meta",
    canvasNavigationOverride: "Meta"
  }, fallback, "darwin");
  assert.equal(normalized.canvasWheelOverride, "Meta");
  assert.equal(normalized.canvasNavigationOverride, "Meta");

  const conflictingChord = normalizeSettings({
    shortcuts: { home: "Meta+Space", renameWindow: "F2" },
    canvasWheelOverride: "Meta+Space"
  }, fallback, "darwin");
  assert.equal(conflictingChord.canvasWheelOverride, null);
});

test("a saved edge pan preference survives normalization", () => {
  const normalized = normalizeSettings({ edgePan: true, edgePanSpeed: "fast" }, fallback);
  assert.equal(normalized.edgePan, true);
  assert.equal(normalized.edgePanSpeed, "fast");
});

test("keeps a valid custom Home grid including plugin widgets", () => {
  const layout = normalizeHomeLayout([
    { widgetId: "core.clock", column: 0, row: 0, columnSpan: 8, rowSpan: 4 },
    { widgetId: "plugin:com.example.clock:weather", column: 8, row: 0, columnSpan: 4, rowSpan: 4 },
    { widgetId: "core.settings", column: 10, row: 6, columnSpan: 2, rowSpan: 2 }
  ]);

  assert.deepEqual(layout.map((item) => item.widgetId), [
    "core.clock",
    "plugin:com.example.clock:weather",
    "core.settings"
  ]);
});

test("drops overlapping Home placements and always preserves a Settings entry point", () => {
  const layout = normalizeHomeLayout([
    { widgetId: "core.clock", column: 0, row: 0, columnSpan: 12, rowSpan: 8 },
    { widgetId: "core.media", column: 0, row: 0, columnSpan: 2, rowSpan: 2 }
  ]);

  assert.deepEqual(layout.map((item) => item.widgetId), ["core.settings"]);
});
