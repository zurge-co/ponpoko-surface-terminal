const THAI_SAMPLE = "\u0e01\u0e02\u0e04\u0e07\u0e0d\u0e19\u0e33\u0e40\u0e01\u0e47\u0e1a";

export async function warmTerminalThai(family: string, size: number): Promise<boolean> {
  try {
    const faces = await document.fonts.load(`${size}px ${family}`, THAI_SAMPLE);
    return faces.length > 0;
  } catch {
    return false;
  }
}
