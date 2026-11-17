import { concat, encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

/**
 * Speed records committed to by a checkpoint's Merkle root.
 *
 * The tree is OpenZeppelin's "standard Merkle tree" format, so the contract can verify
 * proofs with OpenZeppelin's MerkleProof (F3): leaves are hashed twice
 * (keccak256(keccak256(abi.encode(fields)))), which keeps a leaf from ever being read as an
 * internal node, and internal nodes hash sorted pairs. Odd nodes are never duplicated, so two
 * different record sets cannot share a root (F9).
 *
 * Every leaf also includes the device (wallet) address, so another device that anchors the same
 * root cannot pass these records off as its own.
 *
 * Every leaf includes a random 32-byte salt kept only on the device. Revealing one record's
 * proof exposes sibling hashes, and without the salt a sibling covering a GPS point could be
 * brute-forced back to its coordinates; with it, siblings reveal nothing (F13).
 */

/** The fields of a record a checkpoint commits to. */
export interface LeafRecord {
  timestamp: number; // ms
  latitude: number; // degrees
  longitude: number; // degrees
  speed: number; // mph
  accuracy: number; // meters
  salt: Hex; // 32 random bytes
}

/** Mirrors SpeedRegistry.RecordLeaf. */
export const RECORD_LEAF_COMPONENTS = [
  { name: 'timestampMs', type: 'uint64' },
  { name: 'latE6', type: 'int32' },
  { name: 'lonE6', type: 'int32' },
  { name: 'speedCentiMph', type: 'uint32' },
  { name: 'accuracyCm', type: 'uint32' },
  { name: 'salt', type: 'bytes32' },
] as const;

export interface RecordLeafValues {
  timestampMs: bigint;
  latE6: number;
  lonE6: number;
  speedCentiMph: number;
  accuracyCm: number;
  salt: Hex;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Record ${name} is not a finite number`);
  return value;
}

/** Fixed-point values exactly as the contract sees them. */
export function toLeafValues(record: LeafRecord): RecordLeafValues {
  if (!/^0x[0-9a-fA-F]{64}$/.test(record.salt)) throw new Error('Record salt must be 32 bytes');
  return {
    timestampMs: BigInt(Math.round(finite(record.timestamp, 'timestamp'))),
    latE6: Math.round(finite(record.latitude, 'latitude') * 1e6),
    lonE6: Math.round(finite(record.longitude, 'longitude') * 1e6),
    speedCentiMph: Math.max(0, Math.round(finite(record.speed, 'speed') * 100)),
    accuracyCm: Math.max(0, Math.round(finite(record.accuracy, 'accuracy') * 100)),
    salt: record.salt,
  };
}

/** Matches SpeedRegistry.recordLeafHash(device, record) and OpenZeppelin's standardLeafHash. */
export function recordLeaf(device: Address, record: LeafRecord): Hex {
  const values = toLeafValues(record);
  const encoded = encodeAbiParameters(
    [{ type: 'address' }, { type: 'tuple', components: RECORD_LEAF_COMPONENTS }],
    [device, values]
  );
  return keccak256(keccak256(encoded));
}

function hashPair(a: Hex, b: Hex): Hex {
  return keccak256(a.toLowerCase() < b.toLowerCase() ? concat([a, b]) : concat([b, a]));
}

/**
 * Builds the tree as a flat array, the way OpenZeppelin's StandardMerkleTree does:
 * leaves sorted by hash and stored at the end, each parent at i with children 2i+1, 2i+2.
 * tree[0] is the root.
 */
export function buildRecordTree(device: Address, records: LeafRecord[]): { root: Hex; tree: Hex[] } {
  if (records.length === 0) throw new Error('Cannot build a tree with no records');
  const leaves = records.map((r) => recordLeaf(device, r)).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  const tree: Hex[] = new Array(2 * leaves.length - 1);
  leaves.forEach((leaf, i) => {
    tree[tree.length - 1 - i] = leaf;
  });
  for (let i = tree.length - 1 - leaves.length; i >= 0; i--) {
    tree[i] = hashPair(tree[2 * i + 1]!, tree[2 * i + 2]!);
  }
  return { root: tree[0]!, tree };
}

/** Sibling hashes from `leaf` up to the root. */
export function recordProof(tree: Hex[], leaf: Hex): Hex[] {
  let index = tree.findIndex((node, i) => i >= (tree.length - 1) / 2 && node.toLowerCase() === leaf.toLowerCase());
  if (index < 0) throw new Error('Leaf is not in this tree');
  const proof: Hex[] = [];
  while (index > 0) {
    proof.push(tree[index % 2 === 1 ? index + 1 : index - 1]!);
    index = Math.floor((index - 1) / 2);
  }
  return proof;
}

/** Same computation as OpenZeppelin's MerkleProof.verify. */
export function verifyRecordProof(root: Hex, leaf: Hex, proof: Hex[]): boolean {
  return proof.reduce<Hex>((hash, sibling) => hashPair(hash, sibling), leaf).toLowerCase() === root.toLowerCase();
}
