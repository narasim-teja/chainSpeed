// Run with: bun test services/identity
import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/p256';
import { bytesToHex } from 'viem';
import { checkpointDigest } from './checkpointDigest';
import { derSignatureToRS } from './signature';
import { OutOfOrderCheckpointError, toCheckpointInput } from './checkpointInput';

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

describe('checkpointDigest', () => {
  test('matches the golden digest pinned in the contract tests', () => {
    const digest = checkpointDigest(296, '0x00000000000000000000000000000000000000aa', '0x00000000000000000000000000000000000000bb', {
      seq: 7n,
      prevRoot: `0x${'11'.repeat(32)}`,
      merkleRoot: `0x${'22'.repeat(32)}`,
      startTime: 1763294400n,
      endTime: 1763294430n,
      avgSpeed: 35,
      maxSpeed: 45,
      minSpeed: 25,
      distanceMeters: 500,
      recordCount: 30,
    });
    expect(digest).toBe('0x9bf14b2b2ab464ce68eced28124946410d3750ecf6c692e0270c05a9d6256790');
  });
});

describe('derSignatureToRS', () => {
  const priv = p256.utils.randomPrivateKey();
  const pub = p256.getPublicKey(priv, false);
  const digest = new Uint8Array(32).fill(5);

  test('round-trips a DER signature to a verifying (r, s)', () => {
    const sig = p256.sign(digest, priv, { lowS: true, prehash: false });
    const { r, s } = derSignatureToRS(`0x${sig.toDERHex()}`);
    const rebuilt = new p256.Signature(BigInt(r), BigInt(s));
    expect(p256.verify(rebuilt, digest, pub, { prehash: false })).toBe(true);
  });

  test('normalizes a high-s signature (the enclave can return either)', () => {
    const low = p256.sign(digest, priv, { lowS: true, prehash: false });
    const high = new p256.Signature(low.r, N - low.s);
    expect(high.hasHighS()).toBe(true);
    const { s } = derSignatureToRS(`0x${high.toDERHex()}`);
    expect(BigInt(s)).toBe(low.s);
  });

  test('rejects malformed DER', () => {
    expect(() => derSignatureToRS('0x3000')).toThrow();
    expect(() => derSignatureToRS('0x1234')).toThrow();
  });
});

describe('toCheckpointInput', () => {
  const position = { seq: 4n, prevRoot: `0x${'aa'.repeat(32)}` as const, lastEndTime: 1_000n };
  const base = {
    merkleRoot: 'bb'.repeat(32),
    startTime: 1_001_000, // ms
    endTime: 1_031_000,
    avgSpeed: 35.6,
    maxSpeed: 44.2,
    minSpeed: 20.1,
    distanceMeters: 480.7,
    recordCount: 30,
  };

  test('chains to the on-chain position and converts units', () => {
    const input = toCheckpointInput(base, position);
    expect(input.seq).toBe(5n);
    expect(input.prevRoot).toBe(position.prevRoot);
    expect(input.merkleRoot).toBe(`0x${'bb'.repeat(32)}`);
    expect(input.startTime).toBe(1001n);
    expect(input.endTime).toBe(1031n);
    expect([input.avgSpeed, input.maxSpeed, input.minSpeed, input.distanceMeters]).toEqual([36, 44, 20, 481]);
  });

  test('never starts before the previous window ended', () => {
    const input = toCheckpointInput({ ...base, startTime: 999_500, endTime: 1_000_400 }, position);
    expect(input.startTime).toBe(1000n);
    expect(input.endTime).toBe(1001n); // end stays strictly after start
  });

  test('rejects a window older than the chain head instead of re-timing it', () => {
    // Recorded 500-530s; the chain already ends at 1000s.
    const old = { ...base, startTime: 500_000, endTime: 530_000 };
    expect(() => toCheckpointInput(old, position)).toThrow(OutOfOrderCheckpointError);
  });

  test('allows at most one second of rounding overlap', () => {
    const twoSecondsEarly = { ...base, startTime: 998_000, endTime: 1_028_000 };
    expect(() => toCheckpointInput(twoSecondsEarly, position)).toThrow(OutOfOrderCheckpointError);
  });

  test('rejects a root that is not 32 bytes', () => {
    expect(() => toCheckpointInput({ ...base, merkleRoot: 'abc' }, position)).toThrow();
  });
});
