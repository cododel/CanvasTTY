import type { BrowserViewportBounds } from "../../../shared/contracts.ts";

const MIN_BROWSER_PAGE_SCALE = 0.5;
const MAX_BROWSER_PAGE_SCALE = 3;

export function normalizeBrowserViewportBounds(value: unknown): BrowserViewportBounds | null {
  if (!value || typeof value !== "object") return null;
  const bounds = value as BrowserViewportBounds;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
  if (bounds.surface !== "native" && bounds.surface !== "placeholder" && bounds.surface !== "hidden") {
    return null;
  }

  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  const left = Math.floor(bounds.x);
  const top = Math.floor(bounds.y);
  const right = width === 0 ? left : Math.ceil(bounds.x + width);
  const bottom = height === 0 ? top : Math.ceil(bounds.y + height);
  const canvasScale = Number.isFinite(bounds.canvasScale)
    ? Math.min(MAX_BROWSER_PAGE_SCALE, Math.max(MIN_BROWSER_PAGE_SCALE, bounds.canvasScale!))
    : undefined;

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    surface: bounds.surface,
    ...(canvasScale === undefined ? {} : { canvasScale }),
    showAgentPresence: bounds.showAgentPresence === true
  };
}
