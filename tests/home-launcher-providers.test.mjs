import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PROVIDERS,
  LIMIT_PROVIDERS,
  homeLauncherColumnCount,
  resolveHomeLimitProviders,
  resolveHomeLauncherProviders,
  setHomeLimitProviderEnabled,
  setHomeLauncherProviderEnabled
} from "../src/renderer/src/lib/providers.ts";

test("stale settings keep every current agent visible in the HOME launcher", () => {
  assert.deepEqual(resolveHomeLauncherProviders({}), AGENT_PROVIDERS);
});

test("the HOME launcher column count follows the buttons that are actually visible", () => {
  assert.equal(homeLauncherColumnCount([]), 2);
  assert.equal(homeLauncherColumnCount(["claude", "kimi", "grok"]), 5);
  assert.equal(homeLauncherColumnCount(AGENT_PROVIDERS), AGENT_PROVIDERS.length + 2);
});

test("the HOME launcher follows the persisted provider subset in canonical order", () => {
  assert.deepEqual(
    resolveHomeLauncherProviders({ homeLauncherProviders: ["hermes", "codex"] }),
    ["codex", "hermes"]
  );
  assert.deepEqual(resolveHomeLauncherProviders({ homeLauncherProviders: [] }), []);
});

test("toggling one launcher provider preserves every unrelated choice", () => {
  assert.deepEqual(
    setHomeLauncherProviderEnabled(["codex", "kimi", "hermes"], "opencode", true),
    ["codex", "kimi", "opencode", "hermes"]
  );
  assert.deepEqual(
    setHomeLauncherProviderEnabled(["codex", "kimi", "opencode", "hermes"], "opencode", false),
    ["codex", "kimi", "hermes"]
  );
});

test("stale settings keep every real limit provider visible", () => {
  assert.deepEqual(resolveHomeLimitProviders({}), LIMIT_PROVIDERS);
});

test("HOME limit visibility is canonical and independent from launcher visibility", () => {
  assert.deepEqual(
    resolveHomeLimitProviders({
      homeLauncherProviders: ["grok"],
      homeLimitProviders: ["grok", "kimi", "opencode", "codex"]
    }),
    ["codex", "kimi", "opencode", "grok"]
  );
  assert.deepEqual(resolveHomeLimitProviders({ homeLimitProviders: [] }), []);
});

test("toggling a HOME limit provider preserves the other limit choices", () => {
  assert.deepEqual(
    setHomeLimitProviderEnabled(["codex", "kimi", "grok"], "opencode", true),
    ["codex", "kimi", "opencode", "grok"]
  );
  assert.deepEqual(
    setHomeLimitProviderEnabled(["codex", "kimi", "opencode", "grok"], "opencode", false),
    ["codex", "kimi", "grok"]
  );
});
