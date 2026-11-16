import type { Hex } from 'viem';

/** P-256 group order. */
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
/** OpenZeppelin's P256 rejects s > N/2 to prevent signature malleability. */
const HALF_N = N / 2n;

function readInteger(bytes: Uint8Array, offset: number): { value: bigint; next: number } {
  if (bytes[offset] !== 0x02) throw new Error('DER: expected INTEGER');
  const length = bytes[offset + 1];
  if (length === undefined || length === 0 || length > 33) throw new Error('DER: bad INTEGER length');
  const start = offset + 2;
  const end = start + length;
  if (end > bytes.length) throw new Error('DER: truncated INTEGER');
  let value = 0n;
  for (let i = start; i < end; i++) value = (value << 8n) | BigInt(bytes[i]!);
  return { value, next: end };
}

function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.slice(2);
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Invalid hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const toBytes32 = (value: bigint): Hex => `0x${value.toString(16).padStart(64, '0')}`;

/**
 * Converts the Secure Enclave's DER-encoded ECDSA signature
 * (SEQUENCE { INTEGER r, INTEGER s }) into the (r, s) pair the contract takes,
 * normalizing s into the lower half of the curve order.
 */
export function derSignatureToRS(der: Hex): { r: Hex; s: Hex } {
  const bytes = hexToBytes(der);
  if (bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) throw new Error('DER: expected SEQUENCE');
  const r = readInteger(bytes, 2);
  const s = readInteger(bytes, r.next);
  if (s.next !== bytes.length) throw new Error('DER: trailing bytes');

  if (r.value <= 0n || r.value >= N || s.value <= 0n || s.value >= N) throw new Error('Signature out of range');
  const lowS = s.value > HALF_N ? N - s.value : s.value;
  return { r: toBytes32(r.value), s: toBytes32(lowS) };
}
