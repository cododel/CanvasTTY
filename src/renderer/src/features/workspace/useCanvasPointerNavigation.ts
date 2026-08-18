import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { AppSettings, CameraState, Point } from "../../../../shared/contracts";
import { EDGE_PAN_SPEEDS, edgePanVelocity } from "./edgePan";

interface PanState {
  pointerId: number;
  startClient: Point;
  startCamera: CameraState;
  moved: boolean;
  suppressClick: boolean;
}

interface NativePanState {
  tabId: string;
  startClient: Point;
  startCamera: CameraState;
}

interface UseCanvasPointerNavigationOptions {
  viewport: RefObject<HTMLDivElement | null>;
  settings: AppSettings;
  cameraRef: MutableRefObject<CameraState>;
  canvasOverrideActiveRef: RefObject<boolean>;
  commitCamera(camera: CameraState): void;
}

export interface CanvasPointerNavigationController {
  panning: boolean;
  handlePointerDownCapture(event: React.PointerEvent<HTMLDivElement>): boolean;
  handleClickCapture(event: React.MouseEvent<HTMLDivElement>): boolean;
  handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void;
  handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void;
  handlePointerEnd(event: React.PointerEvent<HTMLDivElement>): void;
  handlePointerLeave(): void;
}

export function useCanvasPointerNavigation({
  viewport,
  settings,
  cameraRef,
  canvasOverrideActiveRef,
  commitCamera
}: UseCanvasPointerNavigationOptions): CanvasPointerNavigationController {
  const panState = useRef<PanState | null>(null);
  const nativePanState = useRef<NativePanState | null>(null);
  const suppressClick = useRef(false);
  const [panning, setPanning] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const edgePointer = useRef<Point | null>(null);
  const edgeFrame = useRef<number | null>(null);
  const edgeLastTime = useRef(0);

  const panTo = useCallback((clientX: number, clientY: number): void => {
    const state = panState.current;
    if (!state) return;
    if (Math.abs(clientX - state.startClient.x) > 3 || Math.abs(clientY - state.startClient.y) > 3) {
      state.moved = true;
    }
    commitCamera({
      ...state.startCamera,
      x: state.startCamera.x + clientX - state.startClient.x,
      y: state.startCamera.y + clientY - state.startClient.y
    });
  }, [commitCamera]);

  const finishPan = useCallback((): void => {
    const state = panState.current;
    if (!state) return;
    if (state.moved || state.suppressClick) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    const element = viewport.current;
    if (element?.hasPointerCapture(state.pointerId)) element.releasePointerCapture(state.pointerId);
    panState.current = null;
    window.canvasTTY.canvasNavigation.setPointerGestureActive(false);
    setPanning(false);
  }, [viewport]);

  const resetPan = useCallback((): void => {
    const pointerId = panState.current?.pointerId;
    const element = viewport.current;
    if (pointerId !== undefined && element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    if (panState.current) window.canvasTTY.canvasNavigation.setPointerGestureActive(false);
    panState.current = null;
    nativePanState.current = null;
    setPanning(false);
  }, [viewport]);

  useEffect(() => {
    window.addEventListener("blur", resetPan);
    return () => window.removeEventListener("blur", resetPan);
  }, [resetPan]);

  useEffect(() => () => {
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
    if (panState.current) window.canvasTTY.canvasNavigation.setPointerGestureActive(false);
  }, []);

  useEffect(() => window.canvasTTY.browser.onCanvasNavigationPointer((event) => {
    if (panState.current && event.type !== "down") {
      if (event.type === "move") panTo(event.clientX, event.clientY);
      else finishPan();
      return;
    }
    if (event.type === "down") {
      nativePanState.current = {
        tabId: event.tabId,
        startClient: { x: event.clientX, y: event.clientY },
        startCamera: cameraRef.current
      };
      setPanning(true);
      return;
    }
    const state = nativePanState.current;
    if (!state || state.tabId !== event.tabId) return;
    if (event.type === "move") {
      commitCamera({
        ...state.startCamera,
        x: state.startCamera.x + event.clientX - state.startClient.x,
        y: state.startCamera.y + event.clientY - state.startClient.y
      });
      return;
    }
    nativePanState.current = null;
    setPanning(false);
  }), [cameraRef, commitCamera, finishPan, panTo]);

  const startPan = useCallback((event: React.PointerEvent<HTMLDivElement>, override = false): void => {
    const blocked = event.button !== 0
      || (!override && (event.target as HTMLElement).closest('[data-interactive="true"]') !== null);
    if (blocked) return;
    if (override) {
      event.preventDefault();
      event.stopPropagation();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panState.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startCamera: cameraRef.current,
      moved: false,
      suppressClick: override
    };
    window.canvasTTY.canvasNavigation.setPointerGestureActive(true);
    setPanning(true);
  }, [cameraRef]);

  const edgePanStep = useCallback((time: number): void => {
    edgeFrame.current = null;
    const pointer = edgePointer.current;
    if (!pointer || panState.current || nativePanState.current || !settingsRef.current.edgePan) return;
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const hovered = document.elementFromPoint(pointer.x, pointer.y);
    if (hovered?.closest('[data-interactive="true"]')) return;
    const velocity = edgePanVelocity(pointer, bounds, {
      maxSpeed: EDGE_PAN_SPEEDS[settingsRef.current.edgePanSpeed]
    });
    if (!velocity) return;
    const dt = edgeLastTime.current === 0 ? 0 : Math.min(0.05, (time - edgeLastTime.current) / 1000);
    edgeLastTime.current = time;
    commitCamera({
      ...cameraRef.current,
      x: cameraRef.current.x + velocity.x * dt,
      y: cameraRef.current.y + velocity.y * dt
    });
    edgeFrame.current = requestAnimationFrame(edgePanStep);
  }, [cameraRef, commitCamera, viewport]);

  const handlePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>): boolean => {
    if (!canvasOverrideActiveRef.current || !isCanvasWidgetTarget(event.target)) return false;
    startPan(event, true);
    return true;
  }, [canvasOverrideActiveRef, startPan]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const state = panState.current;
    if (state?.pointerId === event.pointerId) panTo(event.clientX, event.clientY);
    if (!settingsRef.current.edgePan) {
      edgePointer.current = null;
      return;
    }
    edgePointer.current = { x: event.clientX, y: event.clientY };
    if (edgeFrame.current === null) {
      edgeLastTime.current = 0;
      edgeFrame.current = requestAnimationFrame(edgePanStep);
    }
  }, [edgePanStep, panTo]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (panState.current?.pointerId === event.pointerId) finishPan();
  }, [finishPan]);

  const handlePointerLeave = useCallback((): void => {
    edgePointer.current = null;
  }, []);

  return {
    panning,
    handlePointerDownCapture,
    handleClickCapture,
    handlePointerDown: startPan,
    handlePointerMove,
    handlePointerEnd,
    handlePointerLeave
  };
}

function isCanvasWidgetTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    '[data-wheel-owner="local"], [data-interactive="true"], [data-canvas-zoom-surface="application"]'
  ));
}
