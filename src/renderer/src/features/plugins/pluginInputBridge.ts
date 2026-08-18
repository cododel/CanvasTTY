export interface PluginCanvasWheelInput {
  clientX: number;
  clientY: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type PluginCanvasFocusInput =
  | { type: "focus" }
  | { type: "hover"; active: boolean };

export function pluginCanvasFocusInput(message: unknown): PluginCanvasFocusInput | null {
  if (!isRecord(message) || message.source !== "canvastty-plugin") return null;
  if (message.type === "canvas-focus") {
    return hasExactKeys(message, ["source", "type"]) ? { type: "focus" } : null;
  }
  if (message.type === "canvas-hover" && typeof message.active === "boolean") {
    return hasExactKeys(message, ["source", "type", "active"])
      ? { type: "hover", active: message.active }
      : null;
  }
  return null;
}

export function pluginCanvasWheelInput(
  message: unknown,
  frame: {
    left: number;
    top: number;
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
  }
): PluginCanvasWheelInput | null {
  if (!isRecord(message) || message.source !== "canvastty-plugin" || message.type !== "canvas-wheel") return null;
  if (!hasExactKeys(message, [
    "source", "type", "clientX", "clientY", "deltaX", "deltaY", "deltaMode",
    "ctrlKey", "metaKey", "altKey", "shiftKey"
  ])) return null;
  if (![frame.left, frame.top, frame.width, frame.height, frame.layoutWidth, frame.layoutHeight]
    .every(Number.isFinite)) return null;
  if (frame.width <= 0 || frame.height <= 0 || frame.layoutWidth <= 0 || frame.layoutHeight <= 0) return null;
  const clientX = finiteNumber(message.clientX);
  const clientY = finiteNumber(message.clientY);
  const deltaX = finiteNumber(message.deltaX);
  const deltaY = finiteNumber(message.deltaY);
  const deltaMode = finiteNumber(message.deltaMode);
  if (clientX === null || clientY === null || deltaX === null || deltaY === null || deltaMode === null) return null;
  if (clientX < 0 || clientY < 0 || clientX > frame.layoutWidth || clientY > frame.layoutHeight) return null;
  if (!Number.isInteger(deltaMode) || deltaMode < 0 || deltaMode > 2) return null;
  const { ctrlKey, metaKey, altKey, shiftKey } = message;
  if (typeof ctrlKey !== "boolean" || typeof metaKey !== "boolean"
    || typeof altKey !== "boolean" || typeof shiftKey !== "boolean") return null;
  const scaleX = deltaMode === 1 ? 16 : deltaMode === 2 ? frame.width : 1;
  const scaleY = deltaMode === 1 ? 16 : deltaMode === 2 ? frame.height : 1;
  const coordinateScaleX = frame.width / frame.layoutWidth;
  const coordinateScaleY = frame.height / frame.layoutHeight;
  return {
    clientX: frame.left + clientX * coordinateScaleX,
    clientY: frame.top + clientY * coordinateScaleY,
    deltaX: clamp(deltaX * scaleX),
    deltaY: clamp(deltaY * scaleY),
    ctrlKey,
    metaKey,
    altKey,
    shiftKey
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number): number {
  return Math.min(1_200, Math.max(-1_200, value));
}
