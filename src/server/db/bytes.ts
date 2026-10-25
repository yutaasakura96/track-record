/**
 * `bytea` as the driver hands it back. Over Neon's HTTP protocol that is the
 * hex text Postgres prints (`\x504b…`); a driver that parses it gives bytes.
 */
export function storedBytes(file: unknown): Uint8Array {
  if (typeof file === "string") {
    const hex = file.startsWith("\\x") ? file.slice(2) : file;
    return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  }
  return new Uint8Array(file as ArrayBufferLike);
}
