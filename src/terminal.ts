import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { Terminal } from "@xterm/xterm";

import { bytesToBase64, textChunks } from "./base64";
import { createTerminalApi } from "./api";
import type { SurfaceLink } from "./bridge";
import {
  MAX_BATCH_BYTES,
  MAX_TABS,
  MAX_WRITE_CHUNK_BYTES,
  POLL_ACTIVE_MS,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_SCROLLBACK,
  TERMINAL_THEME,
  themeFor,
} from "./config";
import { TERMINAL_KEY_HINT } from "./keymap";
import { renderTabs as renderTabStrip, type Tab } from "./terminal/strip";
import { handleKey as handleTabKey, type KeyPorts } from "./terminal/keys";
import { sessionOps } from "./terminal/session";
import { clamp, element, message, shellName } from "./terminal/helpers";
import { legacyCopy } from "./terminal/legacy";
import { cleanTabTitle, moveItem } from "./tabs";

const TEXT_ENCODER = new TextEncoder();
const MIN_COLS = 1;
const MAX_COLS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 200;

export interface TerminalAppOptions {
  root: HTMLElement;
  link: SurfaceLink;
}

export function createTerminalApp({ root, link }: TerminalAppOptions): void {
  const api = createTerminalApi(link);
  const tabs: Tab[] = [];
  let activeKey: string | null = null;
  let counter = 0;
  let fitTimer: number | null = null;

  let editingKey: string | null = null;
  let editValue = "";
  let dragKey: string | null = null;
  let dropSlot: number | null = null;

  root.classList.add("terminal-shell");

  const bar = element("div", "terminal-bar");
  const tabsEl = element("div", "terminal-tabs");
  tabsEl.setAttribute("role", "tablist");
  tabsEl.setAttribute("aria-label", "Terminal shells");
  const dropIndicator = element("div", "terminal-drop-indicator");
  dropIndicator.setAttribute("aria-hidden", "true");
  dropIndicator.hidden = true;
  tabsEl.append(dropIndicator);
  const barSpace = element("div", "terminal-bar-space");
  const newButton = element("button", "terminal-new", "+");
  newButton.type = "button";
  newButton.title = "New shell (Cmd+T / Ctrl+Shift+T)";
  newButton.setAttribute("aria-label", "New shell");
  newButton.addEventListener("click", () => openTab());
  bar.append(tabsEl, barSpace, newButton);

  const body = element("div", "terminal-body");
  const empty = element("div", "terminal-empty");
  const emptyTitle = element("p", "terminal-empty-title", "No shells are open");
  const emptyButton = element("button", "terminal-empty-button", "Open a shell");
  emptyButton.type = "button";
  emptyButton.addEventListener("click", () => openTab());
  empty.append(emptyTitle, emptyButton);
  body.append(empty);

  const notice = element("div", "terminal-notice");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");

  const hint = element("div", "terminal-hint", TERMINAL_KEY_HINT);

  root.replaceChildren(bar, body, notice, hint);

  const activeTab = (): Tab | null => tabs.find((tab) => tab.key === activeKey) ?? null;

  const say = (text: string, error = false): void => {
    notice.textContent = text;
    notice.classList.toggle("is-error", error);
  };

  const fitActive = (): void => {
    const tab = activeTab();
    if (tab) fitTab(tab);
  };

  const scheduleFit = (): void => {
    if (fitTimer !== null) window.clearTimeout(fitTimer);
    fitTimer = window.setTimeout(() => {
      fitTimer = null;
      fitActive();
    }, 80);
  };

  function fitTab(tab: Tab): { cols: number; rows: number } {
    try {
      tab.fit.fit();
    } catch {
    }
    const cols = clamp(tab.term.cols || tab.cols || 80, MIN_COLS, MAX_COLS);
    const rows = clamp(tab.term.rows || tab.rows || 24, MIN_ROWS, MAX_ROWS);
    if (tab.backendId && (cols !== tab.cols || rows !== tab.rows)) {
      tab.cols = cols;
      tab.rows = rows;
      void api.resize(tab.backendId, cols, rows).catch((error) => {
        say(`The terminal could not be resized: ${message(error)}`, true);
      });
    }
    return { cols, rows };
  }

  function activate(tab: Tab): void {
    activeKey = tab.key;
    for (const other of tabs) other.pane.classList.toggle("is-active", other.key === tab.key);
    renderTabs();
    empty.hidden = tabs.length > 0;
    window.requestAnimationFrame(() => {
      fitTab(tab);
      if (editingKey !== tab.key) tab.term.focus();
    });
  }

  function renderTabs(): void {
    renderTabStrip({
      tabs: () => tabs,
      activeKey: () => activeKey,
      dragKey: () => dragKey,
      setDragKey: (key) => {
        dragKey = key;
      },
      dropSlot: () => dropSlot,
      setDropSlot: (slot) => {
        dropSlot = slot;
      },
      editingKey: () => editingKey,
      editValue: () => editValue,
      setEditValue: (value) => {
        editValue = value;
      },
      tabsEl,
      dropIndicator,
      empty,
      activate,
      closeTab,
      openTab,
      beginRename,
      commitRename,
      cancelRename,
      moveTabTo,
      moveTabBy,
      endDrag,
      paintDropIndicator,
    });
  }

  function beginRename(tab: Tab): void {
    if (dragKey !== null) return;
    editingKey = tab.key;
    editValue = tab.title;
    renderTabs();
  }

  function commitRename(tab: Tab): void {
    if (editingKey !== tab.key) return;
    tab.title = cleanTabTitle(editValue, tab.title);
    editingKey = null;
    editValue = "";
    renderTabs();
  }

  function cancelRename(): void {
    if (editingKey === null) return;
    editingKey = null;
    editValue = "";
    renderTabs();
  }

  function moveTabTo(key: string, to: number, focusTab: boolean): void {
    const from = tabs.findIndex((tab) => tab.key === key);
    if (from < 0) return;
    const next = moveItem(tabs, from, to);
    tabs.splice(0, tabs.length, ...next);
    renderTabs();
    if (focusTab) focusTabNode(key);
  }

  function moveTabBy(tab: Tab, direction: -1 | 1, focusTab: boolean): void {
    const from = tabs.indexOf(tab);
    if (from < 0) return;
    const to = from + direction;
    if (to < 0 || to >= tabs.length) return;
    moveTabTo(tab.key, to, focusTab);
  }

  function focusTabNode(key: string): void {
    const node = tabNodes().find((child) => child.dataset.key === key);
    node?.focus();
  }

  function tabNodes(): HTMLElement[] {
    return Array.from(tabsEl.querySelectorAll<HTMLElement>(".terminal-tab"));
  }

  function endDrag(): void {
    dragKey = null;
    dropSlot = null;
    dropIndicator.hidden = true;
    for (const item of tabNodes()) item.classList.remove("is-dragging");
  }

  function paintDropIndicator(): void {
    const nodes = tabNodes();
    if (dropSlot === null || nodes.length === 0) {
      dropIndicator.hidden = true;
      return;
    }
    const last = nodes[nodes.length - 1];
    const left =
      dropSlot >= nodes.length ? last.offsetLeft + last.offsetWidth : nodes[dropSlot].offsetLeft;
    dropIndicator.style.left = `${left}px`;
    dropIndicator.hidden = false;
  }

  function closeTab(tab: Tab): void {
    if (!tabs.includes(tab)) return;
    if (editingKey === tab.key) {
      editingKey = null;
      editValue = "";
    }
    if (dragKey === tab.key) endDrag();
    tab.alive = false;
    wake(tab);
    if (tab.backendId) void api.close(tab.backendId).catch(() => {});
    if (tab.flushFrame > 0) window.cancelAnimationFrame(tab.flushFrame);
    tab.flushFrame = 0;
    tab.outbox = [];
    tab.outboxBytes = 0;
    tab.term.dispose();
    tab.pane.remove();
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);
    if (activeKey === tab.key) {
      activeKey = null;
      const next = tabs[Math.min(index, tabs.length - 1)];
      if (next) activate(next);
      else renderTabs();
    } else {
      renderTabs();
    }
  }

  function openTab(): void {
    if (tabs.length >= MAX_TABS) {
      say(`This terminal already has ${MAX_TABS} shells open (the limit) — close one first.`, true);
      return;
    }

    counter += 1;
    const index = counter;
    const pane = element("div", "terminal-pane");
    body.append(pane);

    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: TERMINAL_SCROLLBACK,
      rightClickSelectsWord: true,
      macOptionIsMeta: false,
      theme: TERMINAL_THEME,
    });

    try {
      term.loadAddon(new UnicodeGraphemesAddon());
    } catch (error) {
      say(`Thai cursor clustering is unavailable in this webview: ${message(error)}`, true);
    }
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(pane);

    const tab: Tab = {
      key: `tab-${index}`,
      index,
      title: `Shell ${index}`,
      term,
      fit,
      pane,
      backendId: null,
      status: "starting",
      cols: 0,
      rows: 0,
      alive: true,
      wakeRequested: false,
      wake: null,
      pollDelay: POLL_ACTIVE_MS,
      outbox: [],
      outboxBytes: 0,
      flushFrame: 0,
      pending: [],
      pendingBytes: 0,
      inputQueue: Promise.resolve(),
    };
    tabs.push(tab);

    term.attachCustomKeyEventHandler((event) => handleKey(tab, event));
    term.onData((data) => queueInput(tab, data));

    activate(tab);
    renderTabs();

    window.requestAnimationFrame(() => {
      if (!tab.alive) return;
      const size = fitTab(tab);
      void startSession(tab, size.cols, size.rows);
    });
  }

  const session = sessionOps({
    api,
    say,
    writeOut,
    wake,
    waitForWake,
    message,
    renderTabs,
    flushOut,
    sendInput,
    shellName,
  });
  const { startSession, queueInput } = session;

  async function sendInput(tab: Tab, data: string): Promise<void> {
    const backendId = tab.backendId;
    if (!tab.alive || !backendId) return;
    for (const chunk of textChunks(data, MAX_WRITE_CHUNK_BYTES)) {
      if (!tab.alive || tab.backendId !== backendId) return;
      await api.write(backendId, bytesToBase64(chunk));
    }
    tab.wakeRequested = true;
    wake(tab);
  }

  const keyPorts: KeyPorts = {
    openTab,
    moveTabBy,
    copySelection,
    queueInput,
  };

  function handleKey(tab: Tab, event: KeyboardEvent): boolean {
    return handleTabKey(keyPorts, tab, event);
  }

  function copySelection(tab: Tab): void {
    const selection = tab.term.getSelection();
    if (selection.length === 0) return;
    const fallback = (): void => legacyCopy(selection);
    try {
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === "function") {
        void clipboard.writeText(selection).then(
          () => tab.term.clearSelection(),
          fallback,
        );
        return;
      }
    } catch {
    }
    fallback();
  }

  function writeOut(tab: Tab, data: string | Uint8Array): void {
    const bytes = typeof data === "string" ? TEXT_ENCODER.encode(data) : data;
    if (bytes.length === 0) return;
    tab.outbox.push(bytes);
    tab.outboxBytes += bytes.length;
    if (document.visibilityState === "hidden" || tab.outboxBytes >= MAX_BATCH_BYTES) {
      flushOut(tab);
      return;
    }
    if (tab.flushFrame !== 0) return;
    tab.flushFrame = window.requestAnimationFrame(() => {
      tab.flushFrame = 0;
      flushOut(tab);
    });
  }

  function flushOut(tab: Tab): void {
    if (tab.flushFrame > 0) {
      window.cancelAnimationFrame(tab.flushFrame);
      tab.flushFrame = 0;
    }
    if (tab.outbox.length === 0) return;
    const merged = new Uint8Array(tab.outboxBytes);
    let at = 0;
    for (const chunk of tab.outbox) {
      merged.set(chunk, at);
      at += chunk.length;
    }
    tab.outbox = [];
    tab.outboxBytes = 0;
    tab.term.write(merged);
  }

  function wake(tab: Tab): void {
    const finish = tab.wake;
    if (!finish) return;
    tab.wake = null;
    finish();
  }

  function waitForWake(tab: Tab, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (tab.wake === finish) tab.wake = null;
        resolve();
      };
      const timer = window.setTimeout(finish, ms);
      tab.wake = finish;
    });
  }

  const observer = new ResizeObserver(() => scheduleFit());
  observer.observe(body);

  window.addEventListener("focus", () => {
    const tab = activeTab();
    if (tab && tab.alive) {
      tab.term.focus();
      tab.pollDelay = POLL_ACTIVE_MS;
      wake(tab);
    }
  });

  document.addEventListener("visibilitychange", () => {
    const tab = activeTab();
    if (!tab || !tab.alive) return;
    if (document.visibilityState === "visible") {
      tab.pollDelay = POLL_ACTIVE_MS;
      wake(tab);
    } else {
      flushOut(tab);
    }
  });

  window.addEventListener("pagehide", () => {
    for (const tab of tabs) {
      if (!tab.backendId) continue;
      void api.close(tab.backendId).catch(() => {});
      tab.backendId = null;
      tab.alive = false;
    }
  });

  link.onHello(() => {
    if (tabs.length === 0) openTab();
  });

  link.onPalette((tokens) => {
    for (const tab of tabs) {
      tab.term.options.theme = themeFor(tokens);
    }
  });
  link.announceReady();
}

