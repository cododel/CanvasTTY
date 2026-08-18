import assert from "node:assert/strict";
import test from "node:test";
import { normalizePluginBrowserUrl } from "../src/main/services/browser/PluginBrowserOpenPolicy.ts";

test("normalizes only absolute HTTP(S) URLs for plugin browser.open", () => {
  assert.equal(normalizePluginBrowserUrl("https://example.com/a").toString(), "https://example.com/a");
  assert.equal(normalizePluginBrowserUrl("http://localhost:9210").toString(), "http://localhost:9210/");
});

test("rejects privileged, credentialed, malformed, and overlong plugin browser URLs", () => {
  for (const value of [
    "file:///tmp/private.html",
    "about:blank",
    "data:text/html,owned",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "not a URL",
    `https://example.com/${"a".repeat(2_100)}`
  ]) {
    assert.throws(() => normalizePluginBrowserUrl(value), /Only HTTP\(S\) URLs are allowed/);
  }
});
