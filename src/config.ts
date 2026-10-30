export const TERMINAL_FONT_FAMILY =
  '"SF Mono", "SFMono-Regular", Menlo, Monaco, "Noto Sans Thai", "IBM Plex Sans Thai Looped", Thonburi, Ayuthaya, monospace';

export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_SCROLLBACK = 10_000;

export const TERMINAL_THEME = {
  background: "#14100c",
  foreground: "#f3e7d7",
  cursor: "#7dba37",
  cursorAccent: "#14100c",
  selectionBackground: "rgba(125, 186, 55, 0.25)",
  selectionForeground: "#f3e7d7",
  black: "#1e1813",
  red: "#ff6b6b",
  green: "#acda52",
  yellow: "#eaee5c",
  blue: "#8fc9a8",
  magenta: "#c77d4c",
  cyan: "#7fc9b5",
  white: "#f3e7d7",
  brightBlack: "#927e6a",
  brightRed: "#ff8787",
  brightGreen: "#c4e87a",
  brightYellow: "#f2f59a",
  brightBlue: "#b0dfc4",
  brightMagenta: "#e0a789",
  brightCyan: "#a6ddd0",
  brightWhite: "#fdf6ea",
};

export const POLL_ACTIVE_MS = 16;

export const POLL_IDLE_MS = 500;

export function nextPollDelay(previous: number): number {
  if (!Number.isFinite(previous) || previous <= 0) return POLL_ACTIVE_MS;
  return Math.min(POLL_IDLE_MS, previous * 2);
}

export const MAX_BATCH_BYTES = 64 * 1024;

export const MAX_POLL_BYTES = 256 * 1024;

export const MAX_WRITE_CHUNK_BYTES = 16 * 1024;

export const MAX_TABS = 8;

export function themeFor(tokens: Record<string, string>): typeof TERMINAL_THEME {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const pick = (value: string | undefined, fallback: string) =>
    typeof value === "string" && hex.test(value) ? value.toLowerCase() : fallback;
  const background = pick(tokens.base, TERMINAL_THEME.background);
  const foreground = pick(tokens.text, TERMINAL_THEME.foreground);
  const accent = pick(tokens.accent, TERMINAL_THEME.cursor);
  const rgba = (colour: string, alpha: number) =>
    `rgba(${Number.parseInt(colour.slice(1, 3), 16)}, ${Number.parseInt(
      colour.slice(3, 5),
      16,
    )}, ${Number.parseInt(colour.slice(5, 7), 16)}, ${alpha})`;
  return {
    ...TERMINAL_THEME,
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: rgba(accent, 0.25),
    selectionForeground: foreground,
    black: pick(tokens.panel, TERMINAL_THEME.black),
    white: foreground,
  };
}
