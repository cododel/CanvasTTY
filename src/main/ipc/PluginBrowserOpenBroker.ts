import type { BrowserWindow } from "electron";
import { IPC, type PluginBrowserOpenRequest, type PluginBrowserOpenResponse } from "../../shared/contracts.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

interface PendingRequest {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Main-process request/response bridge for a sandboxed plugin asking the
 * trusted workspace renderer to display the embedded browser card.
 */
export class PluginBrowserOpenBroker {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly getMainWindow: () => BrowserWindow | null;
  private readonly timeoutMs: number;
  private sequence = 0;

  constructor(getMainWindow: () => BrowserWindow | null, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.getMainWindow = getMainWindow;
    this.timeoutMs = timeoutMs;
  }

  request(pluginId: string, url: string): Promise<void> {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return Promise.reject(new Error("Plugin browser.open failed because the main renderer is unavailable."));
    }

    const request: PluginBrowserOpenRequest = {
      requestId: `plugin-browser-${(++this.sequence).toString(36)}`,
      pluginId,
      url
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(request.requestId)) return;
        reject(new Error("Plugin browser.open timed out waiting for the main renderer."));
      }, this.timeoutMs);
      this.pending.set(request.requestId, { resolve, reject, timer });

      try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send(IPC.pluginsBrowserOpenRequested, request);
      } catch (error) {
        const pending = this.pending.get(request.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(request.requestId);
        reject(error instanceof Error ? error : new Error("Plugin browser.open could not reach the main renderer."));
      }
    });
  }

  complete(response: PluginBrowserOpenResponse): boolean {
    const pending = this.pending.get(response.requestId);
    if (!pending) return false;
    this.pending.delete(response.requestId);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve();
    } else {
      pending.reject(new Error(response.error || "Plugin browser.open was rejected by the main renderer."));
    }
    return true;
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
