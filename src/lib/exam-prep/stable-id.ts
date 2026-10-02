/**
 * Deterministic ids and content fingerprints for exam-prep rows.
 * The same logical row always gets the same UUID, so a retry upserts
 * instead of inserting a duplicate.
 */

const PUSH_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";

const VOLATILE_KEYS = new Set(["created_at", "updated_at", "created_by"]);

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** SHA-1 digest. Sync so export row ids can be built without a network or async API. */
export function sha1Bytes(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const withBit = data.length + 1;
  const padTo = withBit % 64 <= 56 ? 56 - (withBit % 64) : 56 + (64 - (withBit % 64));
  const padded = new Uint8Array(withBit + padTo + 8);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Uint32Array(80);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotl(
        (words[index - 3]! ^ words[index - 8]! ^ words[index - 14]! ^ words[index - 16]!) >>> 0,
        1,
      );
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let index = 0; index < 80; index += 1) {
      let f = 0;
      let k = 0;
      if (index < 20) {
        f = ((b & c) | (~b & d)) >>> 0;
        k = 0x5a827999;
      } else if (index < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0;
        k = 0x8f1bbcdc;
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + words[index]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Invalid UUID: ${uuid}`);
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function formatUuid(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122 UUID version 5. */
export function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(namespaceBytes.length + nameBytes.length);
  data.set(namespaceBytes);
  data.set(nameBytes, namespaceBytes.length);
  const hash = sha1Bytes(data).slice(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(hash);
}

export function stableUuid(parts: readonly string[]): string {
  return uuidV5(PUSH_NAMESPACE, parts.join("\u001f"));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    out[key] = canonicalize(source[key]);
  }
  return out;
}

/** Fingerprint of the rows that will be written. Timestamps are ignored. */
export function contentHash(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  return bytesToHex(sha1Bytes(new TextEncoder().encode(json)));
}
