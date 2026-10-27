export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function shellName(shell: string): string {
  const parts = shell.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? "shell";
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
