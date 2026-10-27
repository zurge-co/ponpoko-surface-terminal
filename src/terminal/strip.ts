import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

export type TabStatus = "starting" | "running" | "exited" | "failed";

export interface Tab {
  key: string;
  index: number;
  title: string;
  term: Terminal;
  fit: FitAddon;
  pane: HTMLDivElement;
  backendId: string | null;
  status: TabStatus;
  cols: number;
  rows: number;
  alive: boolean;
  wakeRequested: boolean;
  wake: (() => void) | null;
  pollDelay: number;
  outbox: Uint8Array[];
  outboxBytes: number;
  flushFrame: number;
  pending: string[];
  pendingBytes: number;
  inputQueue: Promise<void>;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
import { isNewTabShortcut, moveTabDirection } from "../keymap";
import { dropTargetIndex } from "../tabs";

export interface TabStripPorts {
  tabs(): Tab[];
  activeKey(): string | null;
  dragKey(): string | null;
  setDragKey(key: string | null): void;
  dropSlot(): number | null;
  setDropSlot(slot: number | null): void;
  editingKey(): string | null;
  editValue(): string;
  setEditValue(value: string): void;
  tabsEl: HTMLElement;
  dropIndicator: HTMLElement;
  empty: HTMLElement;
  activate(tab: Tab): void;
  closeTab(tab: Tab): void;
  openTab(): void;
  beginRename(tab: Tab): void;
  commitRename(tab: Tab): void;
  cancelRename(): void;
  moveTabTo(key: string, to: number, focusTab: boolean): void;
  moveTabBy(tab: Tab, direction: -1 | 1, focusTab: boolean): void;
  endDrag(): void;
  paintDropIndicator(): void;
}

export function renderTabs(ports: TabStripPorts): void {
  const { tabsEl, dropIndicator, empty } = ports;
  const tabs = ports.tabs();
  const activeKey = ports.activeKey();
  const dragKey = ports.dragKey();
  const dropSlot = ports.dropSlot();
  const editingKey = ports.editingKey();
  const editValue = ports.editValue();
  const activate = ports.activate;
  const closeTab = ports.closeTab;
  const openTab = ports.openTab;
  const beginRename = ports.beginRename;
  const commitRename = ports.commitRename;
  const cancelRename = ports.cancelRename;
  const endDrag = ports.endDrag;
  const paintDropIndicator = ports.paintDropIndicator;
  const moveTabTo = ports.moveTabTo;
  const moveTabBy = ports.moveTabBy;
    const nodes = tabs.map((tab, index) => {
      const item = element("div", "terminal-tab");
      item.dataset.key = tab.key;
      item.setAttribute("role", "tab");
      item.tabIndex = 0;
      item.setAttribute("aria-selected", String(tab.key === activeKey));
      item.title = `${tab.title}${tab.status === "exited" ? " (exited)" : ""}`;
      item.classList.toggle("is-active", tab.key === activeKey);
      item.classList.toggle("is-dragging", dragKey === tab.key);
      item.draggable = editingKey !== tab.key;

      const dot = element("span", `terminal-dot is-${tab.status}`);
      dot.setAttribute("aria-hidden", "true");

      let titleNode: HTMLElement;
      if (editingKey === tab.key) {
        const input = element("input", "terminal-tab-rename");
        input.value = editValue;
        input.spellcheck = false;
        input.setAttribute("aria-label", `Rename ${tab.title}`);
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("dblclick", (event) => event.stopPropagation());
        input.addEventListener("input", () => {
          ports.setEditValue(input.value);
        });
        input.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commitRename(tab);
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelRename();
          }
        });
        input.addEventListener("blur", () => {
          window.setTimeout(() => commitRename(tab), 0);
        });
        titleNode = input;
      } else {
        const label = element("span", "terminal-tab-title", tab.title);
        label.title = `${tab.title} — double-click to rename`;
        label.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          beginRename(tab);
        });
        titleNode = label;
      }

      const close = element("button", "terminal-tab-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", `Close ${tab.title}`);
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(tab);
      });

      item.addEventListener("click", () => {
        if (tab.key !== activeKey) activate(tab);
        else if (editingKey === null) tab.term.focus();
      });
      item.addEventListener("keydown", (event) => {
        if (editingKey === tab.key) return;
        if (isNewTabShortcut(event)) {
          event.preventDefault();
          openTab();
          return;
        }
        const direction = moveTabDirection(event);
        if (direction !== null) {
          event.preventDefault();
          moveTabBy(tab, direction, true);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(tab);
        }
      });

      item.addEventListener("dragstart", (event) => {
        if (editingKey === tab.key) {
          event.preventDefault();
          return;
        }
        ports.setDragKey(tab.key);
        item.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", tab.key);
        }
      });
      item.addEventListener("dragend", () => endDrag());
      item.addEventListener("dragover", (event) => {
        if (dragKey === null) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        const rect = item.getBoundingClientRect();
        const slot = index + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
        if (slot !== dropSlot) {
          ports.setDropSlot(slot);
          paintDropIndicator();
        }
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        if (dragKey === null) return;
        const from = tabs.findIndex((candidate) => candidate.key === dragKey);
        if (from < 0) {
          endDrag();
          return;
        }
        const to = dropTargetIndex(from, dropSlot ?? index, tabs.length);
        const moved = dragKey;
        endDrag();
        moveTabTo(moved, to, false);
      });

      item.append(dot, titleNode, close);
      return item;
    });
    tabsEl.replaceChildren(...nodes, dropIndicator);
    empty.hidden = tabs.length > 0;
    paintDropIndicator();
    const input = tabsEl.querySelector<HTMLInputElement>(".terminal-tab-rename");
    if (input) {
      window.requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }
}
