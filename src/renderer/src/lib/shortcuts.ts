import {
  activeCanvasNavigationModifiers,
  canvasNavigationModifierFromKey,
  normalizeCanvasNavigationInputKey
} from "../../../shared/canvasNavigation.ts";

interface ShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function shortcutFromKeyboardEvent(event: ShortcutEvent): string | null {
  if (canvasNavigationModifierFromKey(event.key) !== null) return null;
  const key = normalizeCanvasNavigationInputKey(event.key);
  if (!key) return null;

  return [...activeCanvasNavigationModifiers(event), key].join("+");
}

export function matchesShortcut(event: ShortcutEvent, shortcut: string): boolean {
  return shortcutFromKeyboardEvent(event)?.toLowerCase() === shortcut.toLowerCase();
}

export function isShortcutCaptureTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-shortcut-capture="true"]'));
}

export function isRenameInputTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-terminal-rename="true"]'));
}

export function displayCanvasNavigationBinding(binding: string, isMacOS: boolean): string {
  if (!isMacOS) return binding;
  return binding.split("+").map((part) => {
    if (part === "Alt") return "Option";
    if (part === "Meta") return "Command";
    return part;
  }).join("+");
}
