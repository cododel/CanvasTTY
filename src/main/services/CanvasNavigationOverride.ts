import type { Event, Input, WebContents } from "electron";
import {
  canvasNavigationModifierFromKey,
  isCanvasNavigationModifierActive,
  isCanvasNavigationBindingActive,
  isCanvasNavigationBindingKey,
  normalizeCanvasNavigationInputKey,
  parseCanvasNavigationBinding
} from "../../shared/canvasNavigation.ts";

export interface CanvasNavigationKeyboardInput {
  type: "keyDown" | "keyUp";
  key: string;
  code?: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

export interface CanvasNavigationOverrideTransition {
  active: boolean;
  changed: boolean;
  reserved: boolean;
}

export interface CanvasNavigationBindings {
  wheelBinding: string | null;
  navigationBinding: string | null;
}

export interface CanvasNavigationOverrideState {
  wheelActive: boolean;
  navigationActive: boolean;
}

export function shouldPreventCanvasNavigationInput(
  input: Pick<CanvasNavigationKeyboardInput, "key">,
  transition: CanvasNavigationOverrideTransition
): boolean {
  return transition.reserved && canvasNavigationModifierFromKey(input.key) === null;
}

export class CanvasNavigationOverrideTracker {
  private binding: string | null;
  private suspended = false;
  private isActive = false;
  private readonly pressedKeys = new Set<string>();
  private modifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  constructor(binding: string | null) {
    this.binding = binding;
  }

  get active(): boolean {
    return this.isActive;
  }

  get shouldCaptureMenuShortcuts(): boolean {
    const parsed = parseCanvasNavigationBinding(this.binding);
    if (!parsed || !parsed.modifiers.every((modifier) => isCanvasNavigationModifierActive(this.modifiers, modifier))) {
      return false;
    }
    return parsed.key !== null || parsed.modifiers.includes("Alt");
  }

  setBinding(binding: string | null): CanvasNavigationOverrideTransition {
    this.binding = binding;
    return this.clearState();
  }

  setSuspended(suspended: boolean): CanvasNavigationOverrideTransition {
    this.suspended = suspended;
    return this.clearState();
  }

  update(input: CanvasNavigationKeyboardInput): CanvasNavigationOverrideTransition {
    if (this.suspended) return { active: false, changed: false, reserved: false };
    const previous = this.isActive;
    const modifier = canvasNavigationModifierFromKey(input.key);
    this.modifiers = {
      altKey: input.alt,
      ctrlKey: input.control,
      metaKey: input.meta,
      shiftKey: input.shift
    };
    if (modifier !== null) {
      const pressed = input.type === "keyDown";
      if (modifier === "Alt") this.modifiers.altKey = pressed;
      else if (modifier === "Ctrl") this.modifiers.ctrlKey = pressed;
      else if (modifier === "Meta") this.modifiers.metaKey = pressed;
      else this.modifiers.shiftKey = pressed;
    }
    const key = normalizeCanvasNavigationInputKey(input.key, input.code);
    let reserved = modifier !== null && isCanvasNavigationBindingKey(input.key, this.binding);
    if (modifier === null && key && isCanvasNavigationBindingKey(key, this.binding)) {
      if (input.type === "keyDown") {
        const alreadyOwned = this.pressedKeys.has(key);
        const completesBinding = isCanvasNavigationBindingActive({
          ...this.modifiers,
          pressedKeys: new Set([key])
        }, this.binding);
        if (alreadyOwned || completesBinding) {
          this.pressedKeys.add(key);
          reserved = true;
        }
      } else {
        reserved = this.pressedKeys.delete(key);
      }
    }
    this.isActive = isCanvasNavigationBindingActive({
      ...this.modifiers,
      pressedKeys: this.pressedKeys
    }, this.binding);
    return {
      active: this.isActive,
      changed: previous !== this.isActive,
      reserved
    };
  }

  reset(): CanvasNavigationOverrideTransition {
    return this.clearState();
  }

  private clearState(): CanvasNavigationOverrideTransition {
    const changed = this.isActive;
    this.isActive = false;
    this.pressedKeys.clear();
    this.modifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    return { active: false, changed, reserved: false };
  }

}

export class CanvasNavigationInputController {
  private readonly wheelTracker: CanvasNavigationOverrideTracker;
  private readonly navigationTracker: CanvasNavigationOverrideTracker;
  private readonly attachedContents = new Set<WebContents>();
  private readonly onActiveChange: (state: CanvasNavigationOverrideState) => void;
  private menuShortcutContents: WebContents | null = null;

  constructor(
    bindings: CanvasNavigationBindings,
    onActiveChange: (state: CanvasNavigationOverrideState) => void
  ) {
    this.wheelTracker = new CanvasNavigationOverrideTracker(bindings.wheelBinding);
    this.navigationTracker = new CanvasNavigationOverrideTracker(bindings.navigationBinding);
    this.onActiveChange = onActiveChange;
  }

  get active(): boolean {
    return this.navigationTracker.active;
  }

  get wheelActive(): boolean {
    return this.wheelTracker.active;
  }

  attach(contents: WebContents): void {
    if (this.attachedContents.has(contents)) return;
    this.attachedContents.add(contents);
    contents.on("before-input-event", (event, input) => this.handleInput(contents, event, input));
    contents.once("destroyed", () => {
      this.attachedContents.delete(contents);
      if (this.menuShortcutContents === contents) this.menuShortcutContents = null;
      this.resetTrackers();
    });
  }

  setBindings(bindings: CanvasNavigationBindings): void {
    this.releaseMenuShortcuts();
    const previous = this.state();
    this.wheelTracker.setBinding(bindings.wheelBinding);
    this.navigationTracker.setBinding(bindings.navigationBinding);
    this.emitIfChanged(previous);
  }

  setShortcutCaptureActive(active: boolean): void {
    this.releaseMenuShortcuts();
    const previous = this.state();
    this.wheelTracker.setSuspended(active);
    this.navigationTracker.setSuspended(active);
    this.emitIfChanged(previous);
  }

  reset(): void {
    this.releaseMenuShortcuts();
    this.resetTrackers();
  }

  private handleInput(contents: WebContents, event: Event, input: Input): void {
    if (input.type !== "keyDown" && input.type !== "keyUp") return;
    const keyboardInput = {
      type: input.type,
      key: input.key,
      code: input.code,
      alt: input.alt,
      control: input.control,
      meta: input.meta,
      shift: input.shift
    } satisfies CanvasNavigationKeyboardInput;
    const previous = this.state();
    const wheelTransition = this.wheelTracker.update(keyboardInput);
    const navigationTransition = this.navigationTracker.update(keyboardInput);
    const shouldCaptureMenuShortcuts = this.wheelTracker.shouldCaptureMenuShortcuts
      || this.navigationTracker.shouldCaptureMenuShortcuts;
    this.setMenuShortcutCapture(contents, shouldCaptureMenuShortcuts);
    const shouldPrevent = shouldPreventCanvasNavigationInput(input, {
      active: wheelTransition.active || navigationTransition.active,
      changed: wheelTransition.changed || navigationTransition.changed,
      reserved: wheelTransition.reserved || navigationTransition.reserved
    });
    if (shouldPrevent) event.preventDefault();
    this.emitIfChanged(previous);
  }

  private releaseMenuShortcuts(): void {
    if (this.menuShortcutContents && !this.menuShortcutContents.isDestroyed()) {
      this.menuShortcutContents.setIgnoreMenuShortcuts(false);
    }
    this.menuShortcutContents = null;
  }

  private setMenuShortcutCapture(contents: WebContents, active: boolean): void {
    if (this.menuShortcutContents !== contents) this.releaseMenuShortcuts();
    if (active) {
      if (this.menuShortcutContents !== contents) contents.setIgnoreMenuShortcuts(true);
      this.menuShortcutContents = contents;
    } else if (this.menuShortcutContents === contents) {
      this.releaseMenuShortcuts();
    }
  }

  private state(): CanvasNavigationOverrideState {
    return {
      wheelActive: this.wheelTracker.active,
      navigationActive: this.navigationTracker.active
    };
  }

  private resetTrackers(): void {
    const previous = this.state();
    this.wheelTracker.reset();
    this.navigationTracker.reset();
    this.emitIfChanged(previous);
  }

  private emitIfChanged(previous: CanvasNavigationOverrideState): void {
    const current = this.state();
    if (current.wheelActive !== previous.wheelActive
      || current.navigationActive !== previous.navigationActive) {
      this.onActiveChange(current);
    }
  }

}
