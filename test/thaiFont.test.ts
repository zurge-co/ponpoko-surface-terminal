const { describe, test, expect } = await import("bun:test");
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const {
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_THAI_FONT,
} = await import("../src/config");

const SRC = dirname(fileURLToPath(new URL("../src/config.ts", import.meta.url)));
const THAI_BLOCK: Array<[number, number]> = [
  [0x0e01, 0x0e5b],
  [0x200c, 0x200d],
  [0x25cc, 0x25cc],
];
const THAI_INK_EXTENT_EM = 1.27;

interface Face {
  family: string;
  ranges: Array<[number, number]>;
  files: string[];
}

const unquote = (value: string): string => value.trim().replace(/^['"]|['"]$/g, "");
const hex = ([lo, hi]: [number, number]): string =>
  hi === lo ? lo.toString(16) : `${lo.toString(16)}-${hi.toString(16)}`;

function parseRanges(block: string): Array<[number, number]> {
  const declared = /unicode-range:([^;]+);/.exec(block)?.[1] ?? "";
  return declared
    .split(",")
    .map((part) => part.trim().replace(/^U\+/i, ""))
    .filter((part) => part.length > 0)
    .map((part) => {
      const [lo, hi] = part.split("-");
      const start = Number.parseInt(lo, 16);
      return [start, hi ? Number.parseInt(hi, 16) : start] as [number, number];
    });
}

function parseFaces(css: string): Face[] {
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  return blocks.map((block) => ({
    family: unquote(/font-family:\s*([^;]+);/.exec(block)?.[1] ?? ""),
    ranges: parseRanges(block),
    files: [...block.matchAll(/url\(([^)]+)\)/g)].map((match) => unquote(match[1])),
  }));
}

const thaiCss = await Bun.file(resolve(SRC, "fonts.css")).text();
const thaiFaces = parseFaces(thaiCss);

describe("the Thai face is the one the terminal's cells are drawn with", () => {
  test("the shipped @font-face family is exactly the family the font stack puts first", () => {
    expect([...new Set(thaiFaces.map((face) => face.family))]).toEqual([unquote(TERMINAL_THAI_FONT)]);
    expect(TERMINAL_FONT_FAMILY.startsWith(TERMINAL_THAI_FONT)).toBe(true);
    expect(TERMINAL_FONT_FAMILY.endsWith("monospace")).toBe(true);
  });

  test("every Thai face is limited to Thai codepoints, so Latin keeps its mono cell", () => {
    const rules = thaiFaces.map((face) => face.ranges);
    expect(rules.filter((ranges) => ranges.length === 0)).toEqual([]);
    const outside = thaiFaces.flatMap((face) =>
      face.ranges
        .filter(([lo, hi]) => !THAI_BLOCK.some(([from, to]) => lo >= from && hi >= lo && hi <= to))
        .map(hex),
    );
    expect(outside).toEqual([]);
  });

  test("each face points at a font file that is really on disk", () => {
    const missing = thaiFaces
      .flatMap((face) => face.files)
      .filter((file) => !existsSync(resolve(SRC, file)));
    expect(thaiFaces.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe("a terminal row is tall enough for stacked Thai marks", () => {
  test("the row height covers the ink the Thai face draws above and below the baseline", () => {
    const row = TERMINAL_FONT_SIZE * TERMINAL_LINE_HEIGHT;
    const ink = TERMINAL_FONT_SIZE * THAI_INK_EXTENT_EM;
    expect(row).toBeGreaterThanOrEqual(ink);
  });
});
