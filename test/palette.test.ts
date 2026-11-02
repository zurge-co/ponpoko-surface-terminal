import { expect, test } from "bun:test";
import { applyPalette } from "../src/palette";
import { themeFor } from "../src/config";

test("the chrome and terminal renderer both follow the palette", () => {
  const written = new Map<string, string>();
  const root = { style: { colorScheme: "", setProperty: (key: string, value: string) => written.set(key, value) } } as unknown as HTMLElement;
  const tokens = { base: "#e6e9dc", text: "#33412e", panel_hover: "#e1e7d6", accent: "#3c702f", accent_lime: "#3b6c2a", danger: "#895944" };
  applyPalette(tokens, root);
  expect(root.style.colorScheme).toBe("light");
  expect(written.get("--term-bg")).toBe(tokens.base);
  expect(written.get("--term-hover")).toBe(tokens.panel_hover);
  expect(themeFor(tokens)).toMatchObject({ background: tokens.base, foreground: tokens.text, red: tokens.danger, green: tokens.accent_lime, cursor: tokens.accent });
  applyPalette({ base: "#241811", panel_hover: "#32241a" }, root);
  expect(root.style.colorScheme).toBe("dark");
  expect(written.get("--term-hover")).toBe("#32241a");
});
