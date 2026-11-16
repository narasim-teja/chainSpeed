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

/** The checkpoint's values are not physically plausible or do not fit the contract's types (F15). */
export class InvalidCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCheckpointError';
  }
}

/** Above this, a "speed" is a GPS glitch, not driving. */
export const MAX_PLAUSIBLE_MPH = 200;

/** Back-to-back checkpoints can overlap by up to a second from millisecond → second rounding. */
const MAX_ROUNDING_OVERLAP_SECONDS = 1n;

/** Rounds to an unsigned integer, or throws: never clamps an implausible value into range (F15). */
function checkedUint(value: number, max: number, name: string): number {
  if (!Number.isFinite(value)) throw new InvalidCheckpointError(`${name} is not a finite number`);
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > max) throw new InvalidCheckpointError(`${name} ${value} is outside 0-${max}`);
  return rounded;
}

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
 * Values are validated, never clamped: a 300 mph glitch or a NaN distance throws
 * InvalidCheckpointError (F15). The contract separately bounds distance by the window's
 * length and requires min <= avg <= max.
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
    avgSpeed: checkedUint(local.avgSpeed, MAX_PLAUSIBLE_MPH, 'avgSpeed'),
    maxSpeed: checkedUint(local.maxSpeed, MAX_PLAUSIBLE_MPH, 'maxSpeed'),
    minSpeed: checkedUint(local.minSpeed, MAX_PLAUSIBLE_MPH, 'minSpeed'),
    distanceMeters: checkedUint(local.distanceMeters, 65_535, 'distanceMeters'),
    recordCount: checkedUint(local.recordCount, 65_535, 'recordCount'),
  };
}
