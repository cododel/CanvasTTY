import type { Size } from "../../../shared/contracts.ts";

interface BrowserCanvasSinkViewportContents {
  isDestroyed(): boolean;
  enableDeviceEmulation(parameters: Electron.Parameters): void;
  disableDeviceEmulation(): void;
}

export function browserCanvasDeviceEmulationParameters(viewport: Size): Electron.Parameters {
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  return {
    screenPosition: "desktop",
    screenSize: { width, height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: { width, height },
    scale: 1
  };
}

export class BrowserCanvasSinkViewportController {
  private readonly contents: BrowserCanvasSinkViewportContents;
  private preserved = false;
  private disposed = false;

  constructor(contents: BrowserCanvasSinkViewportContents) {
    this.contents = contents;
  }

  preserve(viewport: Size): boolean {
    if (this.disposed || this.contents.isDestroyed()) return false;
    if (this.preserved) return true;
    try {
      this.contents.enableDeviceEmulation(browserCanvasDeviceEmulationParameters(viewport));
      this.preserved = true;
      return true;
    } catch {
      return false;
    }
  }

  restore(): boolean {
    if (!this.preserved) return true;
    this.preserved = false;
    if (this.disposed || this.contents.isDestroyed()) return false;
    try {
      this.contents.disableDeviceEmulation();
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.restore();
    this.disposed = true;
  }
}
