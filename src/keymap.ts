export type TerminalKeyAction =
  | { kind: "send"; data: string; label: string }
  | { kind: "scroll-top" }
  | { kind: "scroll-bottom" }
  | { kind: "page-up" }
  | { kind: "page-down" };

export interface TerminalKeyEvent {
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export function macTerminalKeyAction(event: TerminalKeyEvent): TerminalKeyAction | null {
  if (event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return { kind: "send", data: "\x16\x0a", label: "new line" };
  }
  if (event.ctrlKey || event.shiftKey) return null;
  if (event.altKey && event.metaKey) return null;

  if (event.altKey) {
    switch (event.key) {
      case "ArrowLeft":
        return { kind: "send", data: "\x1bb", label: "previous word" };
      case "ArrowRight":
        return { kind: "send", data: "\x1bf", label: "next word" };
      case "ArrowUp":
        return { kind: "page-up" };
      case "ArrowDown":
        return { kind: "page-down" };
      case "Backspace":
        return { kind: "send", data: "\x1b\x7f", label: "delete the previous word" };
      case "Delete":
        return { kind: "send", data: "\x1bd", label: "delete the next word" };
      default:
        return null;
    }
  }

  if (event.metaKey) {
    switch (event.key) {
      case "ArrowLeft":
        return { kind: "send", data: "\x01", label: "beginning of line" };
      case "ArrowRight":
        return { kind: "send", data: "\x05", label: "end of line" };
      case "ArrowUp":
        return { kind: "scroll-top" };
      case "ArrowDown":
        return { kind: "scroll-bottom" };
      case "Backspace":
        return { kind: "send", data: "\x15", label: "delete before the cursor" };
      case "Delete":
        return { kind: "send", data: "\x0b", label: "delete after the cursor" };
      default:
        return null;
    }
  }

  return null;
}

export function isNewTabShortcut(event: TerminalKeyEvent): boolean {
  if (event.key.toLowerCase() !== "t" || event.altKey) return false;
  if (event.metaKey && !event.ctrlKey && !event.shiftKey) return true;
  return event.ctrlKey && event.shiftKey && !event.metaKey;
}

export function moveTabDirection(event: TerminalKeyEvent): -1 | 1 | null {
  if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return null;
  if (event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowRight") return 1;
  return null;
}

export const TERMINAL_KEY_HINT =
  "Shift+Enter new line · Option+←/→ word · Cmd+←/→ line start/end · Cmd+⌫ delete to line start · Cmd+T new tab · drag tabs to reorder";
