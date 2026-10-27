export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    const slice = bytes.subarray(index, index + step);
    for (const byte of slice) binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  if (!Number.isFinite(size) || size < 1) throw new Error("a chunk size must be at least one byte");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }
  return chunks;
}

export function textChunks(text: string, size: number): Uint8Array[] {
  return chunkBytes(new TextEncoder().encode(text), size);
}
