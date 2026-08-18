import { isSafeBrowserUrl } from "./BrowserPolicyService.ts";

const INVALID_PLUGIN_BROWSER_URL = "Only HTTP(S) URLs are allowed for plugin browser.open.";

/**
 * Normalizes a plugin-supplied URL at the main-process trust boundary.
 * Unlike the human address bar, this capability never turns free text into a
 * search query and never permits privileged browser schemes.
 */
export function normalizePluginBrowserUrl(value: unknown): string {
  if (typeof value !== "string" || !isSafeBrowserUrl(value)) {
    throw new Error(INVALID_PLUGIN_BROWSER_URL);
  }
  return new URL(value).toString();
}
