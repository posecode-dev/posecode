/**
 * posecode-share: the distribution primitive for Posecode.
 *
 * Encodes a `.posecode` document into a compact, URL-safe token so any movement
 * can travel as a link and render wherever it lands. This is the mechanic that
 * lets Posecode spread the way Mermaid did: a document *is* a shareable URL.
 *
 * Pure and dependency-free; runs unchanged in the browser (playground, embeds)
 * and in Node (the MCP server, tests). The token is UTF-8 → base64url so cues
 * with degree signs and curly quotes survive a round-trip intact.
 */

/** Query-style key used inside the URL hash, e.g. `#doc=<token>`. */
export const SHARE_PARAM = "doc";

/**
 * Upper bound on document length we'll put in a URL. Browsers and proxies vary,
 * but ~8k of source keeps the resulting link comfortably within safe limits.
 */
export const MAX_SOURCE_LENGTH = 8000;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Encode a `.posecode` document into a URL-safe token. Throws on invalid input. */
export function encodePosecode(source: string): string {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("encodePosecode: source must be a non-empty string");
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new RangeError(
      `encodePosecode: document is ${source.length} chars, over the ${MAX_SOURCE_LENGTH} limit for a shareable link`,
    );
  }
  return bytesToBase64Url(utf8Encode(source));
}

/** Decode a token back into the original document. Throws if it isn't valid. */
export function decodePosecode(token: string): string {
  if (typeof token !== "string" || !BASE64URL.test(token)) {
    throw new TypeError("decodePosecode: token is not a valid base64url string");
  }
  return utf8Decode(base64UrlToBytes(token));
}

/** Build the URL hash fragment (including the leading `#`) for a document. */
export function buildShareHash(source: string): string {
  return `#${SHARE_PARAM}=${encodePosecode(source)}`;
}

/**
 * Extract a shared document from a `location.hash`. This is the untrusted
 * boundary: a hand-edited or truncated link must degrade to "no shared doc"
 * rather than crash the page, so this never throws: it returns null instead.
 */
export function readShareHash(hash: string): string | null {
  if (typeof hash !== "string") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const prefix = `${SHARE_PARAM}=`;
  if (!raw.startsWith(prefix)) return null;
  const token = raw.slice(prefix.length);
  try {
    return decodePosecode(token);
  } catch {
    return null;
  }
}

// --- UTF-8 + base64url codec ------------------------------------------------
// Fully self-contained: no TextEncoder/atob/Buffer. This keeps posecode-share a
// pure, dependency-free package that compiles and runs identically in the
// browser, in Node, and under any TS lib target.

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function utf8Encode(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    // Combine a surrogate pair into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function utf8Decode(bytes: number[]): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    let code: number;
    if (b0 < 0x80) {
      code = b0;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = ((b0 & 0x1f) << 6) | (bytes[i++]! & 0x3f);
    } else if ((b0 & 0xf0) === 0xe0) {
      code = ((b0 & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    } else {
      code =
        ((b0 & 0x07) << 18) |
        ((bytes[i++]! & 0x3f) << 12) |
        ((bytes[i++]! & 0x3f) << 6) |
        (bytes[i++]! & 0x3f);
    }
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

function bytesToBase64Url(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b0 = bytes[i]!;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;
    out += ALPHABET[b0 >> 2]!;
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    if (hasB1) out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]!;
    if (hasB2) out += ALPHABET[b2 & 0x3f]!;
  }
  return out;
}

function base64UrlToBytes(token: string): number[] {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < token.length; i++) {
    const value = ALPHABET.indexOf(token[i]!);
    if (value < 0) {
      throw new Error("decodePosecode: token contains a non-base64url character");
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}
