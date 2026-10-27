const { describe, test, expect } = await import("bun:test");

import type { HostTransport, SurfaceLink } from "../src/bridge";

const {
  SURFACE_BRIDGE_CHANNEL,
  SURFACE_READY,
  HOST_HELLO,
  TERMINAL_VERB,
  createSurfaceLink,
  viewTokenFromLocation,
} = await import("../src/bridge");
const { SURFACE_BRIDGE_VERBS } = await import("./hostContract");

const TERMINAL_MANIFEST = (await Bun.file(
  new URL("../surface.json", import.meta.url),
).json()) as { methods: string[] };
const declaredMethods = async (): Promise<string[]> => TERMINAL_MANIFEST.methods;
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
const {
  MAX_BATCH_BYTES,
  MAX_POLL_BYTES,
  MAX_TABS,
  MAX_WRITE_CHUNK_BYTES,
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  nextPollDelay,
  TERMINAL_FONT_FAMILY,
  TERMINAL_SCROLLBACK,
  TERMINAL_THEME,
} = await import("../src/config");
const {
  createTerminalApi,
  readListAnswer,
  readOpenAnswer,
  readPollAnswer,
} = await import("../src/api");

const VIEW = "view-token-terminal";

function sourceUrl(file: string): URL {
  return new URL(`../src/${file}`, import.meta.url);
}


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

function recordingLink(answer: (method: string, params: unknown) => unknown): {
  link: SurfaceLink;
  calls: Array<[string, unknown]>;
} {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    link: {
      view: VIEW,
      async callBackend<T>(method: string, params?: unknown): Promise<T> {
        calls.push([method, params]);
        return answer(method, params) as T;
      },
      announceReady() {
      },
      onHello() {
        return () => {};
      },
    },
  };
}
