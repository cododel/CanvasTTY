export type BrowserCanvasCursor = "grab" | "grabbing" | null;

export interface BrowserCanvasCursorContents {
  isDestroyed(): boolean;
  insertCSS(css: string, options: { cssOrigin: "user" }): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
}

export function browserCanvasNavigationCursor(
  navigationActive: boolean,
  dragOwnedByCanvas: boolean
): BrowserCanvasCursor {
  if (dragOwnedByCanvas) return "grabbing";
  return navigationActive ? "grab" : null;
}

export class BrowserCanvasCursorController {
  private readonly contents: BrowserCanvasCursorContents;
  private desired: BrowserCanvasCursor = null;
  private generation = 0;
  private insertedKey: string | null = null;
  private disposed = false;

  constructor(contents: BrowserCanvasCursorContents) {
    this.contents = contents;
  }

  set(cursor: BrowserCanvasCursor): void {
    if (this.disposed || this.desired === cursor) return;
    this.desired = cursor;
    void this.apply();
  }

  refresh(): void {
    if (this.disposed || this.desired === null) return;
    void this.apply();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.desired = null;
    this.generation += 1;
    this.removeCurrent();
  }

  private async apply(): Promise<void> {
    const generation = ++this.generation;
    const cursor = this.desired;
    this.removeCurrent();
    if (cursor === null || this.contents.isDestroyed()) return;

    try {
      const key = await this.contents.insertCSS(
        `html, body, * { cursor: ${cursor} !important; }`,
        { cssOrigin: "user" }
      );
      if (
        this.disposed
        || generation !== this.generation
        || cursor !== this.desired
        || this.contents.isDestroyed()
      ) {
        void this.contents.removeInsertedCSS(key).catch(() => undefined);
        return;
      }
      this.insertedKey = key;
    } catch {
      // A navigation or destroyed tab can invalidate an in-flight CSS insertion.
    }
  }

  private removeCurrent(): void {
    const key = this.insertedKey;
    this.insertedKey = null;
    if (key === null || this.contents.isDestroyed()) return;
    void this.contents.removeInsertedCSS(key).catch(() => undefined);
  }
}
