import type { SurfaceLink } from "./bridge";
import { MAX_POLL_BYTES } from "./config";

export interface OpenRequest {
  cols: number;
  rows: number;
  cwd?: string;
  shell?: string;
}

export interface OpenAnswer {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface PollAnswer {
  data: string;
  bytes: number;
  dropped: number;
  exited: boolean;
  exit_code?: number | null;
  signal?: string | null;
}

export interface SessionInfo {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  exited: boolean;
  exit_code?: number | null;
  signal?: string | null;
  created_ms: number;
}

export interface ListAnswer {
  sessions: SessionInfo[];
}

export interface WriteAnswer {
  ok: boolean;
  bytes: number;
}

export interface ResizeAnswer {
  ok: boolean;
  cols: number;
  rows: number;
}

export interface CloseAnswer {
  ok: boolean;
  closed: boolean;
}

export interface TerminalApi {
  open(request: OpenRequest): Promise<OpenAnswer>;
  write(id: string, data: string): Promise<WriteAnswer>;
  poll(id: string, maxBytes?: number): Promise<PollAnswer>;
  resize(id: string, cols: number, rows: number): Promise<ResizeAnswer>;
  close(id: string): Promise<CloseAnswer>;
  list(): Promise<ListAnswer>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function malformed(method: string, detail: string): Error {
  return new Error(`the terminal backend answered ${method} with something that is not ${detail}`);
}

export function readOpenAnswer(value: unknown): OpenAnswer {
  if (!isRecord(value)) throw malformed("term.open", "a session");
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw malformed("term.open", "a session with an id");
  }
  if (typeof value.pid !== "number" || !Number.isFinite(value.pid)) {
    throw malformed("term.open", "a session with a pid");
  }
  if (typeof value.shell !== "string" || typeof value.cwd !== "string") {
    throw malformed("term.open", "a session with a shell and a cwd");
  }
  if (typeof value.cols !== "number" || typeof value.rows !== "number") {
    throw malformed("term.open", "a session with a size");
  }
  return {
    id: value.id,
    pid: value.pid,
    shell: value.shell,
    cwd: value.cwd,
    cols: value.cols,
    rows: value.rows,
  };
}

export function readPollAnswer(value: unknown): PollAnswer {
  if (!isRecord(value)) throw malformed("term.poll", "a poll answer");
  if (typeof value.data !== "string" || typeof value.bytes !== "number" || typeof value.dropped !== "number") {
    throw malformed("term.poll", "a poll answer with data, bytes and dropped");
  }
  if (typeof value.exited !== "boolean") throw malformed("term.poll", "a poll answer with exited");
  let exitCode: number | null = null;
  if (typeof value.exit_code === "number") {
    exitCode = value.exit_code;
  } else if (value.exit_code !== null && value.exit_code !== undefined) {
    throw malformed("term.poll", "a poll answer with a numeric exit_code");
  }
  let signal: string | null = null;
  if (typeof value.signal === "string") {
    signal = value.signal;
  } else if (value.signal !== null && value.signal !== undefined) {
    throw malformed("term.poll", "a poll answer with a string signal");
  }
  return {
    data: value.data,
    bytes: value.bytes,
    dropped: value.dropped,
    exited: value.exited,
    exit_code: exitCode,
    signal,
  };
}

export function readListAnswer(value: unknown): ListAnswer {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    throw malformed("term.list", "a list of sessions");
  }
  const sessions = value.sessions.map((entry): SessionInfo => {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      throw malformed("term.list", "a list of sessions with ids");
    }
    return {
      id: entry.id,
      pid: typeof entry.pid === "number" ? entry.pid : 0,
      shell: typeof entry.shell === "string" ? entry.shell : "",
      cwd: typeof entry.cwd === "string" ? entry.cwd : "",
      cols: typeof entry.cols === "number" ? entry.cols : 0,
      rows: typeof entry.rows === "number" ? entry.rows : 0,
      exited: entry.exited === true,
      exit_code: typeof entry.exit_code === "number" ? entry.exit_code : null,
      signal: typeof entry.signal === "string" ? entry.signal : null,
      created_ms: typeof entry.created_ms === "number" ? entry.created_ms : 0,
    };
  });
  return { sessions };
}

export function createTerminalApi(link: SurfaceLink): TerminalApi {
  return {
    async open(request) {
      return readOpenAnswer(await link.callBackend("term.open", request));
    },
    async write(id, data) {
      return (await link.callBackend("term.write", { id, data })) as WriteAnswer;
    },
    async poll(id, maxBytes = MAX_POLL_BYTES) {
      return readPollAnswer(await link.callBackend("term.poll", { id, max_bytes: maxBytes }));
    },
    async resize(id, cols, rows) {
      return (await link.callBackend("term.resize", { id, cols, rows })) as ResizeAnswer;
    },
    async close(id) {
      return (await link.callBackend("term.close", { id })) as CloseAnswer;
    },
    async list() {
      return readListAnswer(await link.callBackend("term.list", {}));
    },
  };
}
