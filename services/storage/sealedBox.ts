import { xchacha20poly1305 } from '@noble/ciphers/chacha';

/**
 * Authenticated encryption for values stored on the device (F13).
 *
 * XChaCha20-Poly1305 with a random 24-byte nonce per write. The storage slot's name is bound
 * as associated data, so a ciphertext copied into a different slot fails to open.
 * Format: "enc:v1:" + base64(nonce ‖ ciphertext ‖ tag).
 */
const PREFIX = 'enc:v1:';
export const NONCE_BYTES = 24;
export const KEY_BYTES = 32;

// UTF-8 without TextEncoder/TextDecoder, which Hermes does not fully provide.
function utf8ToBytes(text: string): Uint8Array {
  const binary = unescape(encodeURIComponent(text));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesToUtf8(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return decodeURIComponent(escape(binary));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function seal(key: Uint8Array, slot: string, plaintext: string, nonce: Uint8Array): string {
  if (key.length !== KEY_BYTES) throw new Error('Storage key must be 32 bytes');
  if (nonce.length !== NONCE_BYTES) throw new Error('Nonce must be 24 bytes');
  const ciphertext = xchacha20poly1305(key, nonce, utf8ToBytes(slot)).encrypt(utf8ToBytes(plaintext));
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce);
  out.set(ciphertext, nonce.length);
  return PREFIX + toBase64(out);
}

/** Throws if the key is wrong, the value was modified, or it belongs to another slot. */
export function openSealed(key: Uint8Array, slot: string, sealed: string): string {
  if (!isSealed(sealed)) throw new Error('Value is not sealed');
  const bytes = fromBase64(sealed.slice(PREFIX.length));
  const nonce = bytes.slice(0, NONCE_BYTES);
  const ciphertext = bytes.slice(NONCE_BYTES);
  return bytesToUtf8(xchacha20poly1305(key, nonce, utf8ToBytes(slot)).decrypt(ciphertext));
}
