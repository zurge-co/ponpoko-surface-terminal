export const SURFACE_BRIDGE_CHANNEL = "ponpoko.surface.v1";
export const SURFACE_READY = "ponpoko.surface.ready";
export const HOST_HELLO = "ponpoko.host.hello";
export const HOST_PALETTE = "ponpoko.host.palette";

export type PaletteTokens = Record<string, string>;

export const TERMINAL_VERB = "backend.call" as const;

export interface HostTransport {
  post(message: unknown): void;
  subscribe(handler: (message: unknown) => void): () => void;
}

export function parentTransport(): HostTransport {
  return {
    post: (message) => window.parent.postMessage(message, "*"),
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        handler(event.data);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}

export function viewTokenFromLocation(url: Location | URL = window.location): string {
  return new URLSearchParams(url.search).get("view")?.trim() ?? "";
}

export interface SurfaceLink {
  view: string;
  callBackend<T = unknown>(method: string, params?: unknown): Promise<T>;
  announceReady(): void;
  onHello(handler: (doors: readonly string[]) => void): () => void;
  onPalette(handler: (tokens: PaletteTokens) => void): () => void;
}

export interface SurfaceLinkOptions {
  view: string;
  transport: HostTransport;
  newId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createSurfaceLink(options: SurfaceLinkOptions): SurfaceLink {
  const { view, transport } = options;
  const newId = options.newId ?? defaultId;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const helloHandlers = new Set<(doors: readonly string[]) => void>();
  const paletteHandlers = new Set<(tokens: PaletteTokens) => void>();

  transport.subscribe((message) => {
    if (!isRecord(message)) return;
    if (message.channel !== SURFACE_BRIDGE_CHANNEL || message.view !== view) return;

    if (message.control === HOST_HELLO) {
      const doors = Array.isArray(message.doors)
        ? message.doors.filter((door): door is string => typeof door === "string")
        : [];
      for (const handler of helloHandlers) handler(doors);
      return;
    }

    if (message.control === HOST_PALETTE) {
      const tokens = readPaletteTokens(message.palette);
      if (tokens) for (const handler of paletteHandlers) handler(tokens);
      return;
    }

    const id = typeof message.id === "string" ? message.id : "";
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (message.ok === true) {
      waiter.resolve(message.result);
      return;
    }
    waiter.reject(
      new Error(
        typeof message.error === "string" && message.error.length > 0
          ? message.error
          : "the host refused the call and did not say why",
      ),
    );
  });

  return {
    view,
    callBackend<T>(method: string, params?: unknown): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = newId();
        pending.set(id, { resolve: (value) => resolve(value as T), reject });
        transport.post({
          channel: SURFACE_BRIDGE_CHANNEL,
          view,
          id,
          verb: TERMINAL_VERB,
          payload: { method, params },
        });
      });
    },
    announceReady() {
      transport.post({ channel: SURFACE_BRIDGE_CHANNEL, view, control: SURFACE_READY });
    },
    onHello(handler) {
      helloHandlers.add(handler);
      return () => helloHandlers.delete(handler);
    },
    onPalette(handler) {
      paletteHandlers.add(handler);
      return () => paletteHandlers.delete(handler);
    },
  };
}

export function readPaletteTokens(payload: unknown): PaletteTokens | null {
  if (!isRecord(payload) || !isRecord(payload.tokens)) return null;
  const tokens: PaletteTokens = {};
  for (const [key, value] of Object.entries(payload.tokens)) {
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
      tokens[key] = value.toLowerCase();
    }
  }
  return Object.keys(tokens).length > 0 ? tokens : null;
}

function defaultId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
