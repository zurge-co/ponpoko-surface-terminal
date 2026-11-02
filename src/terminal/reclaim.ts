import type { OpenAnswer, OpenRequest, SessionInfo, TerminalApi } from "../api";

export const RECLAIM_IDLE_MS = 30_000;

export const CLIENT_STORAGE_KEY = "ponpoko.terminal.client";

export interface PageClients {
  own: string;
  previous: string | null;
}

export interface ReclaimPorts {
  api: TerminalApi;
  clients: PageClients;
  idleMs?: number;
}

export interface PageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function pageClients(storage: PageStorage | null = safeStorage()): PageClients {
  const remembered = storage?.getItem(CLIENT_STORAGE_KEY)?.trim() ?? "";
  const own = newToken();
  try {
    storage?.setItem(CLIENT_STORAGE_KEY, own);
  } catch {
  }
  return { own, previous: remembered.length > 0 && remembered !== own ? remembered : null };
}

function safeStorage(): PageStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isReclaimable(session: SessionInfo, clients: PageClients, idleMs: number): boolean {
  if (session.client === clients.own) return false;
  if (session.client !== null && clients.previous !== null && session.client === clients.previous) {
    return true;
  }
  if (session.exited) return true;
  return session.idle_ms >= idleMs;
}

export function reclaimableSessions(
  sessions: readonly SessionInfo[],
  clients: PageClients,
  idleMs: number = RECLAIM_IDLE_MS,
): string[] {
  return sessions
    .filter((session) => isReclaimable(session, clients, idleMs))
    .map((session) => session.id);
}

export async function reclaimSessions(ports: ReclaimPorts): Promise<number> {
  const idleMs = ports.idleMs ?? RECLAIM_IDLE_MS;
  const listed = await ports.api.list();
  const ids = reclaimableSessions(listed.sessions, ports.clients, idleMs);
  let closed = 0;
  for (const id of ids) {
    try {
      await ports.api.close(id);
      closed += 1;
    } catch {
    }
  }
  return closed;
}

export async function openShell(ports: ReclaimPorts, request: OpenRequest): Promise<OpenAnswer> {
  const owned: OpenRequest = { ...request, client: request.client ?? ports.clients.own };
  try {
    return await ports.api.open(owned);
  } catch (error) {
    const freed = await reclaimSessions(ports).catch(() => 0);
    if (freed === 0) throw error;
    return ports.api.open(owned);
  }
}
