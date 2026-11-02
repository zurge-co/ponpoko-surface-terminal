const { describe, test, expect } = await import("bun:test");

import type { OpenAnswer, OpenRequest, PollAnswer, SessionInfo, TerminalApi } from "../src/api";

const { isReclaimable, openShell, pageClients, reclaimSessions, reclaimableSessions, RECLAIM_IDLE_MS } =
  await import("../src/terminal/reclaim");

const CLIENTS = { own: "page-now", previous: "page-before" };

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "t1",
    pid: 1,
    shell: "/bin/zsh",
    cwd: "/Users/human",
    cols: 80,
    rows: 24,
    exited: false,
    exit_code: null,
    signal: null,
    created_ms: 1,
    client: null,
    idle_ms: 0,
    ...overrides,
  };
}

interface FakeApi {
  api: TerminalApi;
  calls: string[];
  openRequests: OpenRequest[];
}

function fakeApi(options: {
  sessions?: SessionInfo[];
  openFails?: number;
  closed?: string[];
} = {}): FakeApi {
  const calls: string[] = [];
  const openRequests: OpenRequest[] = [];
  const closed = options.closed ?? [];
  let remainingFails = options.openFails ?? 0;
  const openAnswer: OpenAnswer = {
    id: "t9",
    pid: 99,
    shell: "/bin/zsh",
    cwd: "/Users/human",
    cols: 80,
    rows: 24,
  };
  const api: TerminalApi = {
    async open(request) {
      calls.push("open");
      openRequests.push(request);
      if (remainingFails > 0) {
        remainingFails -= 1;
        throw new Error("this terminal already has 8 shells open (the limit)");
      }
      return openAnswer;
    },
    async write() {
      calls.push("write");
      return { ok: true, bytes: 0 };
    },
    async poll(): Promise<PollAnswer> {
      calls.push("poll");
      return { data: "", bytes: 0, dropped: 0, exited: false, exit_code: null, signal: null };
    },
    async resize() {
      calls.push("resize");
      return { ok: true, cols: 80, rows: 24 };
    },
    async close(id) {
      calls.push(`close:${id}`);
      closed.push(id);
      return { ok: true, closed: true };
    },
    async list() {
      calls.push("list");
      return { sessions: options.sessions ?? [], limit: 8 };
    },
  };
  return { api, calls, openRequests };
}

describe("reclaiming orphaned shells — a page never keeps a slot it cannot use", () => {
  test("a page never reclaims a shell it opened itself, however quiet it is", () => {
    const mine = session({ client: CLIENTS.own, idle_ms: RECLAIM_IDLE_MS * 10 });
    expect(isReclaimable(mine, CLIENTS, RECLAIM_IDLE_MS)).toBe(false);
    expect(reclaimableSessions([mine], CLIENTS)).toEqual([]);
  });

  test("the page that came before this one is reclaimed the moment it is seen", () => {
    const before = session({ id: "t_old", client: CLIENTS.previous, idle_ms: 0 });
    expect(reclaimableSessions([before], CLIENTS)).toEqual(["t_old"]);
  });

  test("a shell of another live page is only reclaimed once it goes quiet past the window", () => {
    const busy = session({ id: "t_busy", client: "page-other", idle_ms: RECLAIM_IDLE_MS - 1 });
    const quiet = session({ id: "t_quiet", client: "page-other", idle_ms: RECLAIM_IDLE_MS });
    expect(reclaimableSessions([busy, quiet], CLIENTS)).toEqual(["t_quiet"]);
    expect(reclaimableSessions([busy], CLIENTS)).toEqual([]);
  });

  test("an exited shell is reclaimed at once, and an unowned one only once it goes quiet", () => {
    const freshAnonymous = session({ id: "t_fresh", client: null, idle_ms: 0 });
    const quietAnonymous = session({ id: "t_quiet", client: null, idle_ms: RECLAIM_IDLE_MS });
    const exited = session({ id: "t_exit", client: "page-other", idle_ms: 0, exited: true });
    expect(reclaimableSessions([freshAnonymous, quietAnonymous, exited], CLIENTS).sort()).toEqual([
      "t_exit",
      "t_quiet",
    ]);
  });

  test("reclaiming closes exactly the reclaimable sessions and counts them", async () => {
    const closed: string[] = [];
    const sessions = [
      session({ id: "t_mine", client: CLIENTS.own }),
      session({ id: "t_old", client: CLIENTS.previous }),
      session({ id: "t_busy", client: "page-other", idle_ms: 0 }),
    ];
    const { api, calls } = fakeApi({ sessions, closed });
    const freed = await reclaimSessions({ api, clients: CLIENTS });
    expect(freed).toBe(1);
    expect(closed).toEqual(["t_old"]);
    expect(calls.filter((call) => call === "open")).toHaveLength(0);
  });

  test("opening a shell at the limit reclaims first and then opens once more", async () => {
    const closed: string[] = [];
    const sessions = [session({ id: "t_old", client: CLIENTS.previous })];
    const { api, calls, openRequests } = fakeApi({ sessions, closed, openFails: 1 });
    const answer = await openShell({ api, clients: CLIENTS }, { cols: 100, rows: 30 });
    expect(answer.id).toBe("t9");
    expect(calls).toEqual(["open", "list", "close:t_old", "open"]);
    expect(closed).toEqual(["t_old"]);
    expect(openRequests[0].client).toBe(CLIENTS.own);
  });

  test("a refusal nothing could relieve is reported instead of retried forever", async () => {
    const { api, calls } = fakeApi({ sessions: [], openFails: 1 });
    await expect(openShell({ api, clients: CLIENTS }, { cols: 80, rows: 24 })).rejects.toThrow(
      /already has 8 shells open/,
    );
    expect(calls).toEqual(["open", "list"]);
  });

  test("a fresh page remembers its own token and the one it replaced", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const first = pageClients(storage);
    expect(first.previous).toBeNull();
    expect(first.own.length).toBeGreaterThan(0);
    expect(store.get("ponpoko.terminal.client")).toBe(first.own);

    const second = pageClients(storage);
    expect(second.previous).toBe(first.own);
    expect(second.own).not.toBe(first.own);
  });
});
