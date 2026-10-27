import type { Tab } from "./strip";
import { isNewTabShortcut, macTerminalKeyAction, moveTabDirection } from "../keymap";

export interface KeyPorts {
  openTab(): void;
  moveTabBy(tab: Tab, direction: -1 | 1, focusTab: boolean): void;
  copySelection(tab: Tab): void;
  queueInput(tab: Tab, data: string): void;
}

export function handleKey(ports: KeyPorts, tab: Tab, event: KeyboardEvent): boolean {
  const openTab = ports.openTab;
  const moveTabBy = ports.moveTabBy;
  const copySelection = ports.copySelection;
  const queueInput = ports.queueInput;
  if (isNewTabShortcut(event)) {
      if (event.type === "keydown") openTab();
      return false;
    }
    const moveDirection = moveTabDirection(event);
    if (moveDirection !== null) {
      if (event.type === "keydown") moveTabBy(tab, moveDirection, false);
      return false;
    }

    const key = event.key.toLowerCase();
    const copyShortcut =
      (event.metaKey && !event.ctrlKey && !event.altKey && key === "c") ||
      (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && key === "c");
    if (copyShortcut) {
      if (event.type === "keydown") copySelection(tab);
      return false;
    }

    const action = macTerminalKeyAction(event);
    if (!action) return true;
    if (event.type !== "keydown") return false;

    switch (action.kind) {
      case "send":
        queueInput(tab, action.data);
        break;
      case "scroll-top":
        tab.term.scrollToTop();
        break;
      case "scroll-bottom":
        tab.term.scrollToBottom();
        break;
      case "page-up":
        tab.term.scrollPages(-1);
        break;
      case "page-down":
        tab.term.scrollPages(1);
        break;
    }
    return false;
}
