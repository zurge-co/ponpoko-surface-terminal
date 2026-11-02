function luminance(hex: string): number {
  return [1, 3, 5].reduce((sum, offset, i) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const linear = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][i];
  }, 0);
}

export function applyPalette(tokens: Record<string, string>, root: HTMLElement = document.documentElement): void {
  const mapping: Record<string, string> = {
    bg: "base", panel: "panel", raised: "elevated", border: "border",
    fg: "text", "fg-muted": "text_muted", "fg-dim": "text_dim",
    accent: "accent", attention: "attention", danger: "danger", hover: "panel_hover",
  };
  for (const [property, token] of Object.entries(mapping)) {
    const value = tokens[token];
    if (/^#[0-9a-fA-F]{6}$/.test(value ?? "")) root.style.setProperty(`--term-${property}`, value);
  }
  const base = tokens.base;
  if (/^#[0-9a-fA-F]{6}$/.test(base ?? "")) {
    const brightness = luminance(base);
    const light = brightness > 0.4;
    root.style.colorScheme = light ? "light" : "dark";
    if (/^#[0-9a-fA-F]{6}$/.test(tokens.border ?? "")) {
      const colour = tokens.border;
      const channels = [1, 3, 5].map((offset) => Number.parseInt(colour.slice(offset, offset + 2), 16));
      root.style.setProperty("--term-border", `rgba(${channels.join(", ")}, ${light ? 0.18 : 0.06})`);
    }
  }
}
