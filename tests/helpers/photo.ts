/**
 * Images built for the test that reads them (issue #117, the 履歴書's 写真).
 * Every one is INVENTED: a flat background and a block of colour, drawn here
 * pixel by pixel. None is a photograph, and none is of a person.
 */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, data: Uint8Array): number[] {
  const body = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat([...data]));
  return [...be32(data.length), ...body, ...be32(crc32(body))];
}

/** zlib with stored (uncompressed) blocks: valid to every reader, and nothing to get wrong. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  for (let at = 0; at < raw.length || at === 0; at += 0xffff) {
    const block = raw.subarray(at, at + 0xffff);
    const last = at + 0xffff >= raw.length ? 1 : 0;
    out.push(last, block.length & 0xff, block.length >> 8, ~block.length & 0xff, (~block.length >> 8) & 0xff, ...block);
    if (last) break;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  out.push(...be32(((b << 16) | a) >>> 0));
  return new Uint8Array(out);
}

/**
 * An RGB PNG `width` × `height`: pale grey, with a teal block in its middle
 * third. A real file Word and a browser both draw.
 */
export function pngPhoto(width = 300, height = 400): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const inBlock = x > width / 3 && x < (2 * width) / 3 && y > height / 3 && y < (2 * height) / 3;
      raw.set(inBlock ? [40, 140, 150] : [225, 228, 232], row + 1 + x * 3);
    }
  }
  const header = new Uint8Array([...be32(width), ...be32(height), 8, 2, 0, 0, 0]);
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", header),
    ...chunk("IDAT", zlibStored(raw)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

/**
 * A small structurally complete baseline JPEG marker stream for validation tests.
 */
export function jpegPhoto(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...sos, 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
}
