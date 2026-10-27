const { describe, test, expect } = await import("bun:test");

describe("the palette reaches surfaces instead of them guessing", () => {
  test("the terminal keeps its ANSI table and takes only the chrome from the palette", async () => {
    const config = await import("../src/config.ts");
    const themed = config.themeFor({ base: "#101010", text: "#eeeeee", accent: "#c77d4c" });
    expect(themed.background).toBe("#101010");
    expect(themed.foreground).toBe("#eeeeee");
    expect(themed.cursor).toBe("#c77d4c");
    expect(themed.red).toBe(config.TERMINAL_THEME.red);
    expect(themed.green).toBe(config.TERMINAL_THEME.green);
  });
});
