import assert from "node:assert/strict";
import test from "node:test";
import { persistSettingsUpdate } from "../src/renderer/src/features/settings/persistSettings.ts";

test("settings persistence rejects without applying a partial Browser card state", async () => {
  let applied;
  await assert.rejects(
    persistSettingsUpdate(
      async () => { throw new Error("settings I/O failed"); },
      (settings) => { applied = settings; },
      { browserCanvas: { position: { x: 1, y: 2 }, size: { width: 920, height: 620 } } }
    ),
    /settings I\/O failed/
  );
  assert.equal(applied, undefined);
});

test("settings persistence applies only the host-confirmed settings snapshot", async () => {
  let applied;
  const updated = { locale: "en" };
  await persistSettingsUpdate(async () => updated, (settings) => { applied = settings; }, { locale: "ru" });
  assert.equal(applied, updated);
});
