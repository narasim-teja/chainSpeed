import type { Hex } from 'viem';
import type { CheckpointInput } from './checkpointDigest';

/** Where the device's checkpoint chain currently ends on chain. */
export interface ChainPosition {
  seq: bigint;
  prevRoot: Hex;
  lastEndTime: bigint; // seconds
}

/** The fields of a local checkpoint that get signed. Times in milliseconds. */
export interface LocalCheckpoint {
  merkleRoot: string;
  startTime: number;
  endTime: number;
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  distanceMeters: number;
  recordCount: number;
}

/**
 * The checkpoint's window starts before the end of one already on chain, i.e. it is older
 * than the chain head. It can never be anchored: re-timing it would relabel old data as new.
 */
export class OutOfOrderCheckpointError extends Error {
  constructor(readonly startTime: bigint, readonly lastEndTime: bigint) {
    super(`Checkpoint starting at ${startTime} is older than the chain head (ends ${lastEndTime})`);
    this.name = 'OutOfOrderCheckpointError';
  }
}

/** Back-to-back checkpoints can overlap by up to a second from millisecond → second rounding. */
const MAX_ROUNDING_OVERLAP_SECONDS = 1n;

const clampUint = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));

/** The window exactly as recorded, in seconds. */
export function recordedWindow(local: LocalCheckpoint): { startTime: bigint; endTime: bigint } {
  return {
    startTime: BigInt(Math.floor(local.startTime / 1000)),
    endTime: BigInt(Math.floor(local.endTime / 1000)),
  };
}

/**
 * Builds the signed checkpoint from a local one, chained to the current on-chain position.
 *
 * The recorded window is never moved, except to absorb up to one second of rounding overlap
 * with the previous checkpoint (and to give a single-instant window a one-second length).
 * A checkpoint older than the chain head is rejected rather than re-timed.
 *
 * Note: speeds and distance are still clamped to their integer ranges here. Rejecting
 * implausible values instead of clamping is F15, fixed in Tier 2; the contract already
 * rejects physically impossible distances.
 */
export function toCheckpointInput(local: LocalCheckpoint, position: ChainPosition): CheckpointInput {
  const merkleRoot = (local.merkleRoot.startsWith('0x') ? local.merkleRoot : `0x${local.merkleRoot}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(merkleRoot)) throw new Error('Merkle root must be 32 bytes');

  const recorded = recordedWindow(local);
  let { startTime, endTime } = recorded;

  if (startTime < position.lastEndTime) {
    if (position.lastEndTime - startTime > MAX_ROUNDING_OVERLAP_SECONDS || endTime < position.lastEndTime) {
      throw new OutOfOrderCheckpointError(startTime, position.lastEndTime);
    }
    startTime = position.lastEndTime;
  }
  if (endTime <= startTime) endTime = startTime + 1n;

  return {
    seq: position.seq + 1n,
    prevRoot: position.prevRoot,
    merkleRoot,
    startTime,
    endTime,
    avgSpeed: clampUint(local.avgSpeed, 255),
    maxSpeed: clampUint(local.maxSpeed, 255),
    minSpeed: clampUint(local.minSpeed, 255),
    distanceMeters: clampUint(local.distanceMeters, 65_535),
    recordCount: clampUint(local.recordCount, 65_535),
  };
}
