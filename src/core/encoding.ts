/**
 * Decodes the bytes of a source file. Files are read as UTF-8 if they are valid UTF-8;
 * otherwise as Windows-1252, which covers the ISO-8859-1 sources of older Forth systems.
 */
export function decodeSource(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
