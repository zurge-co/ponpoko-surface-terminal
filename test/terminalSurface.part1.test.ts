const { describe, test, expect } = await import("bun:test");

import type { HostTransport } from "../src/bridge";

const {
  SURFACE_BRIDGE_CHANNEL,
  SURFACE_READY,
  HOST_HELLO,
  TERMINAL_VERB,
  createSurfaceLink,
  viewTokenFromLocation,
} = await import("../src/bridge");
const { SURFACE_BRIDGE_VERBS } = await import("./hostContract");

const {
  bytesToBase64,
  chunkBytes,
  decodeBase64,
  textChunks,
} = await import("../src/base64");
const { macTerminalKeyAction, isNewTabShortcut, moveTabDirection, TERMINAL_KEY_HINT } = await import(
  "../src/keymap"
);
const { TAB_TITLE_MAX, cleanTabTitle, dropTargetIndex, moveItem } = await import(
  "../src/tabs"
);
const { MAX_POLL_BYTES, MAX_TABS, MAX_WRITE_CHUNK_BYTES, POLL_ACTIVE_MS, POLL_IDLE_MS, nextPollDelay, TERMINAL_FONT_FAMILY, TERMINAL_SCROLLBACK, TERMINAL_THEME } = await import("../src/config");

const VIEW = "view-token-terminal";

function fakeHost() {
  const posted: Array<Record<string, unknown>> = [];
  let listener: ((message: unknown) => void) | null = null;
  const transport: HostTransport = {
    post: (message) => {
      posted.push(message as Record<string, unknown>);
    },
    subscribe: (handler) => {
      listener = handler;
      return () => {
        listener = null;
      };
    },
  };
  return {
    posted,
    transport,
    deliver: (message: unknown) => listener?.(message),
  };
}

function keyEvent(
  key: string,
  modifiers: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {},
) {
  return {
    key,
    altKey: modifiers.altKey === true,
    metaKey: modifiers.metaKey === true,
    ctrlKey: modifiers.ctrlKey === true,
    shiftKey: modifiers.shiftKey === true,
  };
}

;

describe("terminal wire — the host's closed vocabulary", () => {
  test("the one verb is backend.call, and it is in the host's vocabulary", () => {
    expect(TERMINAL_VERB).toBe("backend.call");
    expect(SURFACE_BRIDGE_VERBS).toContain(TERMINAL_VERB);
  });

  test("a backend call posts the view token, the verb and the method, and resolves the answer", async () => {
    const host = fakeHost();
    const link = createSurfaceLink({
      view: VIEW,
      transport: host.transport,
      newId: () => "req-1",
    });

    link.announceReady();
    expect(host.posted[0]).toEqual({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      control: SURFACE_READY,
    });

    const pending = link.callBackend("demo.open", { cols: 80, rows: 24 });
    expect(host.posted[1]).toEqual({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "req-1",
      verb: "backend.call",
      payload: { method: "demo.open", params: { cols: 80, rows: 24 } },
    });

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "req-1",
      ok: true,
      result: { id: "t1" },
    });
    await expect(pending).resolves.toEqual({ id: "t1" });
  });

  test("a refusal is a sentence, a foreign view is ignored, and the greeting names the host's doors", async () => {
    const host = fakeHost();
    const link = createSurfaceLink({
      view: VIEW,
      transport: host.transport,
      newId: () => "req-2",
    });
    const doors: string[][] = [];
    link.onHello((opened) => doors.push([...opened]));

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: "another-view",
      control: HOST_HELLO,
      doors: ["backend.call"],
    });
    expect(doors).toEqual([]);

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      control: HOST_HELLO,
      doors: ["backend.call"],
    });
    expect(doors).toEqual([["backend.call"]]);

    const pending = link.callBackend("demo.poll", { id: "t1" });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "req-2",
      ok: false,
      error: "the terminal session 't1' is not open",
    });
    await expect(pending).rejects.toThrow(/not open/);
  });

  test("the view token comes from the frame URL", () => {
    const url = new URL("ponpoko-surface://localhost/terminal/index.html?view=abc123");
    expect(viewTokenFromLocation(url)).toBe("abc123");
    expect(viewTokenFromLocation(new URL("ponpoko-surface://localhost/terminal/index.html"))).toBe("");
  });
});

describe("macOS editing keys — the standard terminal byte sequences", () => {
  test("Option+arrows move by word and Option+Delete kills words", () => {
    expect(macTerminalKeyAction(keyEvent("ArrowLeft", { altKey: true }))).toEqual({
      kind: "send",
      data: "\x1bb",
      label: "previous word",
    });
    expect(macTerminalKeyAction(keyEvent("ArrowRight", { altKey: true }))).toEqual({
      kind: "send",
      data: "\x1bf",
      label: "next word",
    });
    expect(macTerminalKeyAction(keyEvent("Backspace", { altKey: true }))).toEqual({
      kind: "send",
      data: "\x1b\x7f",
      label: "delete the previous word",
    });
    expect(macTerminalKeyAction(keyEvent("Delete", { altKey: true }))).toEqual({
      kind: "send",
      data: "\x1bd",
      label: "delete the next word",
    });
  });

  test("Cmd+arrows move to line ends and Cmd+Delete kills the line", () => {
    expect(macTerminalKeyAction(keyEvent("ArrowLeft", { metaKey: true }))).toEqual({
      kind: "send",
      data: "\x01",
      label: "beginning of line",
    });
    expect(macTerminalKeyAction(keyEvent("ArrowRight", { metaKey: true }))).toEqual({
      kind: "send",
      data: "\x05",
      label: "end of line",
    });
    expect(macTerminalKeyAction(keyEvent("Backspace", { metaKey: true }))).toEqual({
      kind: "send",
      data: "\x15",
      label: "delete before the cursor",
    });
    expect(macTerminalKeyAction(keyEvent("Delete", { metaKey: true }))).toEqual({
      kind: "send",
      data: "\x0b",
      label: "delete after the cursor",
    });
  });

  test("Cmd+Up/Down and Option+Up/Down scroll without sending bytes", () => {
    expect(macTerminalKeyAction(keyEvent("ArrowUp", { metaKey: true }))).toEqual({ kind: "scroll-top" });
    expect(macTerminalKeyAction(keyEvent("ArrowDown", { metaKey: true }))).toEqual({ kind: "scroll-bottom" });
    expect(macTerminalKeyAction(keyEvent("ArrowUp", { altKey: true }))).toEqual({ kind: "page-up" });
    expect(macTerminalKeyAction(keyEvent("ArrowDown", { altKey: true }))).toEqual({ kind: "page-down" });
  });

  test("Shift+Enter opens a new line in the command buffer instead of running it", () => {
    expect(macTerminalKeyAction(keyEvent("Enter", { shiftKey: true }))).toEqual({
      kind: "send",
      data: "\x16\x0a",
      label: "new line",
    });
    expect(macTerminalKeyAction(keyEvent("Enter"))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("Enter", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("Enter", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("Enter", { altKey: true, shiftKey: true }))).toBeNull();
    expect(TERMINAL_KEY_HINT).toContain("Shift+Enter");
  });

  test("plain, Ctrl, Shift and combined modifiers stay out of the way", () => {
    expect(macTerminalKeyAction(keyEvent("ArrowLeft"))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("Backspace"))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("ArrowLeft", { ctrlKey: true }))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("ArrowLeft", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("ArrowLeft", { altKey: true, metaKey: true }))).toBeNull();
    expect(macTerminalKeyAction(keyEvent("c", { metaKey: true }))).toBeNull();
    expect(TERMINAL_KEY_HINT).toContain("Option+←/→");
    expect(TERMINAL_KEY_HINT).toContain("Cmd+←/→");
  });
});

describe("terminal tabs — order, drop slot and rename are pure rules", () => {
  test("Cmd+T / Ctrl+Shift+T opens a tab, and Ctrl+T is left to readline", () => {
    expect(isNewTabShortcut(keyEvent("t", { metaKey: true }))).toBe(true);
    expect(isNewTabShortcut(keyEvent("T", { metaKey: true }))).toBe(true);
    expect(isNewTabShortcut(keyEvent("t", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isNewTabShortcut(keyEvent("t", { ctrlKey: true }))).toBe(false);
    expect(isNewTabShortcut(keyEvent("t", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isNewTabShortcut(keyEvent("t", { metaKey: true, ctrlKey: true }))).toBe(false);
    expect(isNewTabShortcut(keyEvent("t", { altKey: true, metaKey: true }))).toBe(false);
  });

  test("Alt+Shift+Left/Right is the tab-reorder gesture", () => {
    expect(moveTabDirection(keyEvent("ArrowLeft", { altKey: true, shiftKey: true }))).toBe(-1);
    expect(moveTabDirection(keyEvent("ArrowRight", { altKey: true, shiftKey: true }))).toBe(1);
    expect(moveTabDirection(keyEvent("ArrowLeft", { altKey: true }))).toBeNull();
    expect(moveTabDirection(keyEvent("ArrowLeft", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(moveTabDirection(keyEvent("ArrowLeft", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  test("moveItem moves without duplicating or losing a tab", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 7, 0)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a"], 0, 0)).toEqual(["a"]);
    expect(moveItem([], 0, 0)).toEqual([]);

    const source = ["a", "b", "c"];
    const moved = moveItem(source, 0, 2);
    expect(moved).not.toBe(source);
    expect(source).toEqual(["a", "b", "c"]);
  });

  test("dropTargetIndex accounts for removing the dragged tab first", () => {
    expect(dropTargetIndex(0, 1, 3)).toBe(0);
    expect(dropTargetIndex(1, 2, 3)).toBe(1);
    expect(dropTargetIndex(0, 2, 3)).toBe(1);
    expect(dropTargetIndex(2, 0, 3)).toBe(0);
    expect(dropTargetIndex(1, 3, 3)).toBe(2);
    expect(dropTargetIndex(0, 3, 3)).toBe(2);
    expect(dropTargetIndex(0, 0, 1)).toBe(0);
  });

  test("cleanTabTitle trims, collapses controls, caps and keeps the fallback", () => {
    expect(cleanTabTitle("  deploy  ", "Shell 1")).toBe("deploy");
    expect(cleanTabTitle("build\n\tlog", "Shell 1")).toBe("build log");
    expect(cleanTabTitle("   ", "Shell 1")).toBe("Shell 1");
    expect(cleanTabTitle("", "Shell 1")).toBe("Shell 1");
    expect(cleanTabTitle("\u0000\u001f", "Shell 2")).toBe("Shell 2");
    expect(cleanTabTitle("ไทย build 01", "Shell 1")).toBe("ไทย build 01");
    expect(Array.from(cleanTabTitle("ก".repeat(TAB_TITLE_MAX + 10), "Shell 1"))).toHaveLength(TAB_TITLE_MAX);
  });
});

describe("base64 byte transport — Thai survives every chunk boundary", () => {
  test("round-trips Thai UTF-8 bytes and control bytes exactly", () => {
    const texts = ["สวัสดีครับ", "ไทย กับ English 123", "a\u0000b\u001bc", "🌸 กับ 🐚"];
    for (const text of texts) {
      const bytes = new TextEncoder().encode(text);
      expect(decodeBase64(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  test("chunks reassemble into the original bytes even when a Thai character is split", () => {
    const text = "ภาษาไทยต้องไม่แตก".repeat(8);
    const bytes = new TextEncoder().encode(text);
    const chunks = textChunks(text, 5);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 5)).toBe(true);

    const joined = new Uint8Array(bytes.length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    expect(offset).toBe(bytes.length);
    expect(joined).toEqual(bytes);
    expect(new TextDecoder().decode(joined)).toBe(text);
  });

  test("empty input is no chunks, and a non-positive chunk size is refused", () => {
    expect(textChunks("", 8)).toEqual([]);
    expect(() => chunkBytes(new Uint8Array([1, 2, 3]), 0)).toThrow();
    expect(() => chunkBytes(new Uint8Array([1]), 2)).not.toThrow();
  });
});

describe("terminal configuration — Thai is a first-class cell concern", () => {
  test("the font stack falls back to macOS Thai faces after the Latin mono", () => {
    const latin = TERMINAL_FONT_FAMILY.indexOf("SF Mono");
    const thai = TERMINAL_FONT_FAMILY.indexOf("IBM Plex Sans Thai Looped");
    expect(latin).toBeGreaterThanOrEqual(0);
    expect(thai).toBeGreaterThan(latin);
    expect(TERMINAL_FONT_FAMILY).toContain("Thonburi");
    expect(TERMINAL_FONT_FAMILY).toContain("Ayuthaya");
  });

  test("the palette is Ponpoko's and the buffers are bounded", () => {
    expect(TERMINAL_THEME.background).toBe("#14100c");
    expect(TERMINAL_THEME.cursor).toBe("#7dba37");
    expect(TERMINAL_SCROLLBACK).toBeGreaterThan(0);
    expect(MAX_TABS).toBeGreaterThan(0);
    expect(POLL_IDLE_MS).toBeGreaterThan(0);
    expect(MAX_POLL_BYTES).toBeGreaterThan(0);
    expect(MAX_WRITE_CHUNK_BYTES).toBeGreaterThan(0);
    expect(MAX_WRITE_CHUNK_BYTES).toBeLessThanOrEqual(MAX_POLL_BYTES);
  });








});

describe("terminal cadence — a burst is fast, a quiet shell is cheap", () => {
  test("the idle pause doubles from the floor to the 500 ms cap, and an unknown state starts at the floor", () => {
    expect(POLL_ACTIVE_MS).toBeGreaterThan(0);
    expect(POLL_ACTIVE_MS).toBeLessThan(POLL_IDLE_MS);

    let delay = POLL_ACTIVE_MS;
    const trail: number[] = [];
    for (let step = 0; step < 8; step += 1) {
      delay = nextPollDelay(delay);
      trail.push(delay);
    }
    expect(trail.slice(0, 6)).toEqual([32, 64, 128, 256, 500, 500]);

    expect(nextPollDelay(0)).toBe(POLL_ACTIVE_MS);
    expect(nextPollDelay(Number.NaN)).toBe(POLL_ACTIVE_MS);
    expect(nextPollDelay(-1)).toBe(POLL_ACTIVE_MS);
  });






});
