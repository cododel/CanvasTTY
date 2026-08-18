import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserCanvasCursorController,
  browserCanvasNavigationCursor
} from "../src/main/services/browser/BrowserCanvasCursor.ts";

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("native Browser cursor follows only full navigation ownership and latches during drag", () => {
  assert.equal(browserCanvasNavigationCursor(false, false), null);
  assert.equal(browserCanvasNavigationCursor(true, false), "grab");
  assert.equal(browserCanvasNavigationCursor(false, true), "grabbing");
  assert.equal(browserCanvasNavigationCursor(true, true), "grabbing");
});

test("native Browser cursor CSS uses user origin and rejects stale async insertion", async () => {
  const insertions = [];
  const removals = [];
  const contents = {
    isDestroyed: () => false,
    insertCSS(css, options) {
      const pending = deferred();
      insertions.push({ css, options, pending });
      return pending.promise;
    },
    async removeInsertedCSS(key) {
      removals.push(key);
    }
  };
  const controller = new BrowserCanvasCursorController(contents);
  controller.set("grab");
  controller.set("grabbing");
  assert.equal(insertions.length, 2);
  assert.match(insertions[0].css, /cursor: grab !important/);
  assert.match(insertions[1].css, /cursor: grabbing !important/);
  assert.deepEqual(insertions[1].options, { cssOrigin: "user" });

  insertions[1].pending.resolve("current-key");
  await Promise.resolve();
  insertions[0].pending.resolve("stale-key");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(removals, ["stale-key"]);

  controller.set(null);
  await Promise.resolve();
  assert.deepEqual(removals, ["stale-key", "current-key"]);
});

test("native Browser cursor reapplies after navigation and cleans up on dispose", async () => {
  let nextKey = 0;
  const removals = [];
  const contents = {
    isDestroyed: () => false,
    async insertCSS() {
      nextKey += 1;
      return `key-${nextKey}`;
    },
    async removeInsertedCSS(key) {
      removals.push(key);
    }
  };
  const controller = new BrowserCanvasCursorController(contents);
  controller.set("grab");
  await Promise.resolve();
  controller.refresh();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(removals.includes("key-1"));
  controller.dispose();
  await Promise.resolve();
  assert.ok(removals.includes("key-2"));
});
