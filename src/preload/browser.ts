import { ipcRenderer } from "electron";

const BROWSER_PAGE_WHEEL_CHANNEL = "browser:page-wheel";
const BROWSER_PAGE_WHEEL_DECISION_CHANNEL = "browser:page-wheel-decision";
const BROWSER_PAGE_WHEEL_IDLE_MS = 250;
type BrowserWheelDecision = {
  generation: number;
  owner: "page" | "canvas";
};

let wheelDecision: (BrowserWheelDecision & { lastEventAt: number }) | null = null;

window.addEventListener("wheel", (event) => {
  if (!event.isTrusted) return;
  const now = performance.now();
  const input = {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    topFrame: window === window.top,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
  if (!wheelDecision || now - wheelDecision.lastEventAt >= BROWSER_PAGE_WHEEL_IDLE_MS) {
    const value = ipcRenderer.sendSync(BROWSER_PAGE_WHEEL_DECISION_CHANNEL, input);
    wheelDecision = isBrowserWheelDecision(value)
      ? { ...value, lastEventAt: now }
      : { generation: 0, owner: "canvas", lastEventAt: now };
  } else {
    wheelDecision.lastEventAt = now;
  }
  const decision = wheelDecision;
  if (decision.owner === "canvas") {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  ipcRenderer.send(BROWSER_PAGE_WHEEL_CHANNEL, {
    ...input,
    generation: decision.generation
  });
}, { capture: true, passive: false });

function isBrowserWheelDecision(value: unknown): value is BrowserWheelDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const decision = value as Record<string, unknown>;
  return Number.isInteger(decision.generation)
    && (decision.generation as number) > 0
    && (decision.owner === "page" || decision.owner === "canvas");
}
