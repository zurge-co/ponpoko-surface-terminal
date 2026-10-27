const { describe, test, expect } = await import("bun:test");

import type { SurfaceLink } from "../src/bridge";





const TERMINAL_MANIFEST = (await Bun.file(
  new URL("../surface.json", import.meta.url),
).json()) as { methods: string[] };
const declaredMethods = async (): Promise<string[]> => TERMINAL_MANIFEST.methods;
const { bytesToBase64 } = await import("../src/base64");


const { MAX_POLL_BYTES } = await import("../src/config");
const {
  createTerminalApi,
  readListAnswer,
  readOpenAnswer,
  readPollAnswer,
} = await import("../src/api");

const VIEW = "view-token-terminal";









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

describe("typed API — the backend's shape is checked at the boundary", () => {
  test("open, poll, write, resize, close and list map to their methods", async () => {
    const answers: unknown[] = [
      { id: "t1", pid: 4242, shell: "/bin/zsh", cwd: "/Users/human", cols: 80, rows: 24 },
      { data: "", bytes: 0, dropped: 0, exited: false, exit_code: null, signal: null },
      { ok: true, closed: false, cols: 80, rows: 24, bytes: 0 },
      { ok: true, closed: false, cols: 80, rows: 24, bytes: 0 },
      { ok: true, closed: true, cols: 80, rows: 24, bytes: 0 },
      { sessions: [] },
    ];
    let next = 0;
    const { link, calls } = recordingLink(() => answers[next++]);
    const api = createTerminalApi(link);

    await api.open({ cols: 80, rows: 24 });
    await api.poll("t1");
    await api.write("t1", bytesToBase64(new TextEncoder().encode("ไทย")));
    await api.resize("t1", 100, 30);
    await api.close("t1");
    await api.list();

    const declared = await declaredMethods();
    const used = calls.map(([method]) => method);
    expect(used).toHaveLength(6);
    for (const method of used) expect(declared).toContain(method);
    expect(calls[0][1]).toEqual({ cols: 80, rows: 24 });
    expect(calls[1][1]).toEqual({ id: "t1", max_bytes: MAX_POLL_BYTES });
    expect(calls[2][1]).toEqual({ id: "t1", data: bytesToBase64(new TextEncoder().encode("ไทย")) });
    expect(calls[3][1]).toEqual({ id: "t1", cols: 100, rows: 30 });
    expect(calls[4][1]).toEqual({ id: "t1" });
  });

  test("malformed backend answers become errors, not an undefined terminal", () => {
    expect(() => readOpenAnswer({ id: "" })).toThrow(/term.open/);
    expect(() => readPollAnswer({ data: 1, bytes: 0, dropped: 0, exited: false })).toThrow(/term.poll/);
    expect(() => readPollAnswer({ data: "", bytes: 0, dropped: 0, exited: "no" })).toThrow(/term.poll/);
    expect(() => readPollAnswer({ data: "", bytes: 0, dropped: 0, exited: false, exit_code: "7" })).toThrow(/term.poll/);
    expect(() => readListAnswer({ sessions: [{ id: 7 }] })).toThrow(/term.list/);
  });

  test("a valid poll answer keeps dropped bytes and the exit status readable", () => {
    expect(
      readPollAnswer({
        data: "4Liq",
        bytes: 3,
        dropped: 128,
        exited: true,
        exit_code: 7,
        signal: null,
      }),
    ).toEqual({
      data: "4Liq",
      bytes: 3,
      dropped: 128,
      exited: true,
      exit_code: 7,
      signal: null,
    });
  });
});
