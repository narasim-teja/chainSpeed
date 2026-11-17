// Run with: bun test services/identity
import { describe, expect, test } from 'bun:test';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { keccak256, toHex, type Hex } from 'viem';
import { buildRecordTree, recordLeaf, recordProof, toLeafValues, verifyRecordProof, type LeafRecord } from './recordTree';

const DEVICE = '0x1111111111111111111111111111111111111111' as const;
const OTHER_DEVICE = '0x2222222222222222222222222222222222222222' as const;
const salt = (i: number) => keccak256(toHex(`salt-${i}`));
const record = (i: number): LeafRecord => ({
  timestamp: 1_763_294_400_000 + i * 1000,
  latitude: 43.653226 + i * 0.00001,
  longitude: -79.383184 - i * 0.00001,
  speed: 30 + i * 0.37,
  accuracy: 4.8,
  salt: salt(i),
});
const LEAF_TYPES = ['address', 'uint64', 'int32', 'int32', 'uint32', 'uint32', 'bytes32'];
const asTuple = (r: LeafRecord) => {
  const v = toLeafValues(r);
  return [DEVICE, v.timestampMs, v.latE6, v.lonE6, v.speedCentiMph, v.accuracyCm, v.salt];
};

describe('record tree', () => {
  for (const n of [1, 2, 3, 5, 30]) {
    test(`matches OpenZeppelin's StandardMerkleTree root and proofs (${n} records)`, () => {
      const records = Array.from({ length: n }, (_, i) => record(i));
      const ours = buildRecordTree(DEVICE, records);
      const reference = StandardMerkleTree.of(records.map(asTuple), LEAF_TYPES);
      expect(ours.root).toBe(reference.root as Hex);

      for (const [i, r] of records.entries()) {
        const leaf = recordLeaf(DEVICE, r);
        expect(leaf).toBe(reference.leafHash(asTuple(r)) as Hex);
        const proof = recordProof(ours.tree, leaf);
        expect(verifyRecordProof(ours.root, leaf, proof)).toBe(true);
        expect(StandardMerkleTree.verify(reference.root, LEAF_TYPES, asTuple(records[i]!), proof)).toBe(true);
      }
    });
  }

  test('F9: a duplicated last record yields a different root (no odd-node duplication)', () => {
    const three = [record(0), record(1), record(2)];
    expect(buildRecordTree(DEVICE, three).root).not.toBe(buildRecordTree(DEVICE, [...three, record(2)]).root);
  });

  test('a proof does not verify a record from another checkpoint', () => {
    const a = buildRecordTree(DEVICE, [record(0), record(1), record(2)]);
    const b = buildRecordTree(DEVICE, [record(10), record(11)]);
    const foreignLeaf = recordLeaf(DEVICE, record(10));
    expect(verifyRecordProof(a.root, foreignLeaf, recordProof(b.tree, foreignLeaf))).toBe(false);
  });

  test('changing any committed field, or the salt, changes the leaf', () => {
    const base = record(0);
    const leaf = recordLeaf(DEVICE, base);
    for (const changed of [
      { ...base, speed: base.speed + 0.01 },
      { ...base, latitude: base.latitude + 0.000001 },
      { ...base, timestamp: base.timestamp + 1 },
      { ...base, salt: salt(99) },
    ]) {
      expect(recordLeaf(DEVICE, changed)).not.toBe(leaf);
    }
  });

  test('leaves are bound to the device: the same records under another device do not verify', () => {
    const records = [record(0), record(1), record(2)];
    const mine = buildRecordTree(DEVICE, records);
    expect(buildRecordTree(OTHER_DEVICE, records).root).not.toBe(mine.root);
    const proof = recordProof(mine.tree, recordLeaf(DEVICE, records[1]!));
    expect(verifyRecordProof(mine.root, recordLeaf(OTHER_DEVICE, records[1]!), proof)).toBe(false);
  });

  test('rejects records without a 32-byte salt or with non-finite values', () => {
    expect(() => recordLeaf(DEVICE, { ...record(0), salt: '0x1234' })).toThrow();
    expect(() => recordLeaf(DEVICE, { ...record(0), speed: Number.NaN })).toThrow();
  });
});
