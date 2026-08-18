import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_CANVAS_FREEZE_GUARD_DIP,
  BROWSER_CANVAS_NATIVE_WHEEL_SINK_SIZE_DIP,
  BROWSER_CANVAS_WHEEL_IDLE_MS,
  BrowserCanvasFreezeFrameStore,
  BrowserCanvasWheelSequence,
  browserCanvasNativeWheelSinkLayout,
  createBrowserCanvasNativeWheelSink,
  browserVisibleRectangle,
  encodeBrowserCanvasFreezeFrame
} from "../src/main/services/browser/BrowserCanvasFreeze.ts";

test("wheel sequence freezes before the logged Browser boundary crosses the pointer", () => {
  const sequence = new BrowserCanvasWheelSequence();
  sequence.begin({ x: 1156, y: 479 }, 1_000);

  assert.equal(BROWSER_CANVAS_FREEZE_GUARD_DIP, 4);
  assert.equal(BROWSER_CANVAS_WHEEL_IDLE_MS, 250);
  assert.equal(sequence.shouldFreeze({ x: 324, y: 283, width: 830, height: 434 }), true);
  assert.equal(sequence.shouldFreeze({ x: 0, y: 0, width: 10, height: 10 }), true);

  assert.equal(sequence.end(), true);
  assert.equal(sequence.shouldFreeze({ x: 324, y: 283, width: 830, height: 434 }), false);
  assert.equal(sequence.end(), false);
});

test("wheel collision uses the visible window-clipped rectangle and latches across direction changes", () => {
  const sequence = new BrowserCanvasWheelSequence();
  sequence.begin({ x: 8, y: 100 }, 0);
  const clipped = browserVisibleRectangle(
    { x: -30, y: 20, width: 42, height: 200 },
    { width: 800, height: 600 }
  );
  assert.deepEqual(clipped, { x: 0, y: 20, width: 12, height: 200 });
  assert.equal(sequence.shouldFreeze(clipped), true);
  assert.equal(sequence.shouldFreeze({ x: 500, y: 500, width: 10, height: 10 }), true);

  sequence.end();
  sequence.begin({ x: 400, y: 300 }, 100);
  assert.equal(sequence.shouldFreeze({ x: 0, y: 0, width: 20, height: 20 }), false);
  assert.equal(sequence.shouldFreeze({ x: 397, y: 0, width: 2, height: 600 }), true);
});

test("wheel collision handles every pan direction and the expanded boundary", () => {
  const rectangles = [
    { x: 104, y: 20, width: 80, height: 160 },
    { x: 16, y: 104, width: 160, height: 80 },
    { x: 104, y: 104, width: 80, height: 80 },
    { x: 16, y: 20, width: 81, height: 81 }
  ];
  for (const rectangle of rectangles) {
    const sequence = new BrowserCanvasWheelSequence();
    sequence.begin({ x: 100, y: 100 }, 0);
    assert.equal(sequence.shouldFreeze(rectangle), true);
  }

  const outside = new BrowserCanvasWheelSequence();
  outside.begin({ x: 100, y: 100 }, 0);
  assert.equal(outside.shouldFreeze({ x: 105, y: 20, width: 80, height: 160 }), false);
});

test("wheel sequence refreshes its pointer and reports expiration from the last event", () => {
  const sequence = new BrowserCanvasWheelSequence();
  const first = sequence.begin({ x: 10, y: 20 }, 1_000);
  const second = sequence.begin({ x: 30, y: 40 }, 1_120);

  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(sequence.shouldFreeze({ x: 28, y: 38, width: 4, height: 4 }), true);
  assert.equal(sequence.expired(1_369), false);
  assert.equal(sequence.expired(1_370), true);
});

test("Browser-origin canvas wheel shrinks the native surface to the pinned hit-test sink", () => {
  const sink = createBrowserCanvasNativeWheelSink(
    "tab-a",
    { x: 318, y: 261, width: 830, height: 433 },
    { x: 681, y: 415 }
  );

  assert.ok(sink);
  assert.equal(BROWSER_CANVAS_NATIVE_WHEEL_SINK_SIZE_DIP, 4);
  assert.deepEqual(browserCanvasNativeWheelSinkLayout(sink, { width: 1_440, height: 900 }), {
    clip: { x: 679, y: 413, width: 4, height: 4 },
    view: { x: 0, y: 0, width: 4, height: 4 }
  });
});

test("native wheel sink clamps to owner edges and rejects points outside the pinned Browser viewport", () => {
  const nearEdge = createBrowserCanvasNativeWheelSink(
    "tab-a",
    { x: -10, y: -20, width: 120, height: 100 },
    { x: 1, y: 1 }
  );
  assert.ok(nearEdge);
  assert.deepEqual(browserCanvasNativeWheelSinkLayout(nearEdge, { width: 80, height: 60 }), {
    clip: { x: 0, y: 0, width: 4, height: 4 },
    view: { x: 0, y: 0, width: 4, height: 4 }
  });

  assert.equal(createBrowserCanvasNativeWheelSink(
    "tab-a",
    { x: 20, y: 20, width: 100, height: 80 },
    { x: 10, y: 10 }
  ), null);
  assert.equal(browserCanvasNativeWheelSinkLayout(nearEdge, { width: 0, height: 60 }), null);
});

test("freeze frame store rejects stale captures and preserves the last frame for the same tab", () => {
  const store = new BrowserCanvasFreezeFrameStore();
  const oldRequest = store.beginCapture("tab-a");
  const currentRequest = store.beginCapture("tab-a");

  assert.equal(store.commitCapture(oldRequest, "data:image/jpeg;base64,old"), null);
  assert.deepEqual(store.commitCapture(currentRequest, "data:image/jpeg;base64,current"), {
    tabId: "tab-a",
    dataUrl: "data:image/jpeg;base64,current"
  });
  assert.equal(store.frameFor("tab-a"), "data:image/jpeg;base64,current");
  assert.equal(store.frameFor("tab-b"), null);

  const failedRequest = store.beginCapture("tab-a");
  store.failCapture(failedRequest);
  assert.equal(store.frameFor("tab-a"), "data:image/jpeg;base64,current");

  const invalidatedRequest = store.beginCapture("tab-a");
  store.invalidateCapture();
  assert.equal(store.commitCapture(invalidatedRequest, "data:image/jpeg;base64,stale"), null);
  assert.equal(store.frameFor("tab-a"), "data:image/jpeg;base64,current");
});

test("freeze frame encoding bounds oversized JPEG output", () => {
  const calls = [];
  const image = {
    getSize: () => ({ width: 2_000, height: 1_000 }),
    toJPEG: (quality) => {
      calls.push({ type: "jpeg", quality });
      return Buffer.alloc(quality === 70 ? 2 * 1024 * 1024 : 200_000, quality);
    },
    resize: ({ width, height }) => {
      calls.push({ type: "resize", width, height });
      return {
        getSize: () => ({ width, height }),
        toJPEG: image.toJPEG,
        resize: image.resize
      };
    }
  };

  const dataUrl = encodeBrowserCanvasFreezeFrame(image);
  assert.match(dataUrl ?? "", /^data:image\/jpeg;base64,/);
  assert.ok(calls.some((call) => call.type === "resize"));
  assert.ok(Buffer.from((dataUrl ?? "").split(",")[1] ?? "", "base64").byteLength <= 1.5 * 1024 * 1024);
});

test("freeze frame encoding repeatedly shrinks incompressible captures", () => {
  const makeImage = (width, height) => ({
    getSize: () => ({ width, height }),
    toJPEG: () => Buffer.alloc(Math.ceil(width * height), 1),
    resize: ({ width: nextWidth, height: nextHeight }) => makeImage(nextWidth, nextHeight)
  });

  const dataUrl = encodeBrowserCanvasFreezeFrame(makeImage(4_000, 3_000));
  assert.match(dataUrl ?? "", /^data:image\/jpeg;base64,/);
  assert.ok(Buffer.from((dataUrl ?? "").split(",")[1] ?? "", "base64").byteLength <= 1.5 * 1024 * 1024);
});
