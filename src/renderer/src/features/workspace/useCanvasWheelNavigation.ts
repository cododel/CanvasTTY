import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { AppSettings, CameraState, Point } from "../../../../shared/contracts";
import {
  canvasWheelIntent,
  normalizeCanvasWheelDeltas,
  shouldCanvasOwnWheel,
  type CanvasWheelDeltas
} from "../../../../shared/canvasNavigation";
import { isFocusedCanvasWidgetTarget } from "./canvasWidgetFocus";
import type { CanvasWidgetFocusState } from "./useCanvasWidgetFocus";

export interface CanvasWheelInput extends CanvasWheelDeltas {
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

interface UseCanvasWheelNavigationOptions {
  viewport: RefObject<HTMLDivElement | null>;
  settings: AppSettings;
  cameraRef: MutableRefObject<CameraState>;
  widgetFocusRef: RefObject<CanvasWidgetFocusState>;
  commitCamera(camera: CameraState): void;
}

export interface CanvasWheelNavigationController {
  canvasOverrideActive: boolean;
  canvasOverrideActiveRef: RefObject<boolean>;
  routeWidgetWheelToCanvas: boolean;
  applyCanvasWheel(event: CanvasWheelInput): void;
  zoomBy(factor: number): void;
}

export function useCanvasWheelNavigation({
  viewport,
  settings,
  cameraRef,
  widgetFocusRef,
  commitCamera
}: UseCanvasWheelNavigationOptions): CanvasWheelNavigationController {
  const [wheelOverrideActive, setWheelOverrideActive] = useState(false);
  const wheelOverrideActiveRef = useRef(false);
  const [canvasOverrideActive, setCanvasOverrideActive] = useState(false);
  const canvasOverrideActiveRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const panFrame = useRef<number | null>(null);
  const pendingPan = useRef<Point>({ x: 0, y: 0 });

  const zoomAt = useCallback((clientX: number, clientY: number, nextZoom: number): void => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const camera = cameraRef.current;
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const worldX = (localX - camera.x) / camera.zoom;
    const worldY = (localY - camera.y) / camera.zoom;
    commitCamera({
      zoom: nextZoom,
      x: localX - worldX * nextZoom,
      y: localY - worldY * nextZoom
    });
  }, [cameraRef, commitCamera, viewport]);

  const flushPan = useCallback((): void => {
    if (panFrame.current !== null) {
      cancelAnimationFrame(panFrame.current);
      panFrame.current = null;
    }
    const delta = pendingPan.current;
    if (delta.x === 0 && delta.y === 0) return;
    pendingPan.current = { x: 0, y: 0 };
    commitCamera({
      ...cameraRef.current,
      x: cameraRef.current.x - delta.x,
      y: cameraRef.current.y - delta.y
    });
  }, [cameraRef, commitCamera]);

  const applyCanvasWheel = useCallback((event: CanvasWheelInput): void => {
    window.canvasTTY.canvasNavigation.armOwnerWheelSequence(event.clientX, event.clientY);
    const intent = canvasWheelIntent(event, event, settingsRef.current);
    if (intent.kind === "pan") {
      pendingPan.current.x += intent.deltaX;
      pendingPan.current.y += intent.deltaY;
      if (panFrame.current === null) panFrame.current = requestAnimationFrame(flushPan);
      return;
    }
    flushPan();
    zoomAt(event.clientX, event.clientY, clamp(cameraRef.current.zoom * intent.factor, 0.2, 1.35));
  }, [cameraRef, flushPan, zoomAt]);

  useEffect(() => () => {
    if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
  }, []);

  useEffect(() => window.canvasTTY.canvasNavigation.onOverrideState(({ wheelActive, navigationActive }) => {
    wheelOverrideActiveRef.current = wheelActive;
    canvasOverrideActiveRef.current = navigationActive;
    viewport.current?.classList.toggle("workspace--canvas-override", navigationActive);
    setWheelOverrideActive(wheelActive);
    setCanvasOverrideActive(navigationActive);
  }), [viewport]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent): void => {
      const browserFreezeOwned = event.target instanceof Element
        && event.target.closest('[data-browser-canvas-wheel-owner="canvas"]') !== null;
      const ownedByCanvas = browserFreezeOwned || shouldCanvasOwnWheel({
        overFocusedWidget: isFocusedCanvasWidgetTarget(event.target, widgetFocusRef.current.id),
        captureMode: settingsRef.current.canvasWheelCaptureMode,
        wheelOverrideActive: wheelOverrideActiveRef.current,
        navigationOverrideActive: canvasOverrideActiveRef.current
      });
      if (!ownedByCanvas) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = element.getBoundingClientRect();
      applyCanvasWheel({
        clientX: event.clientX,
        clientY: event.clientY,
        ...normalizeCanvasWheelDeltas(event.deltaX, event.deltaY, event.deltaMode, bounds),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey
      });
    };
    element.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => element.removeEventListener("wheel", handleWheel, true);
  }, [applyCanvasWheel, viewport, widgetFocusRef]);

  useEffect(() => window.canvasTTY.browser.onCanvasWheel(applyCanvasWheel), [applyCanvasWheel]);

  const zoomBy = useCallback((factor: number): void => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    zoomAt(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
      clamp(cameraRef.current.zoom * factor, 0.2, 1.35)
    );
  }, [cameraRef, viewport, zoomAt]);

  return {
    canvasOverrideActive,
    canvasOverrideActiveRef,
    routeWidgetWheelToCanvas: shouldCanvasOwnWheel({
      overFocusedWidget: true,
      captureMode: settings.canvasWheelCaptureMode,
      wheelOverrideActive,
      navigationOverrideActive: canvasOverrideActive
    }),
    applyCanvasWheel,
    zoomBy
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
