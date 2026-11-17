/**
 * Submits queued checkpoints strictly oldest first.
 *
 * A newer checkpoint must never be anchored ahead of an older one that failed transiently:
 * that would move the chain head past it and make the older window permanently unanchorable
 * (for example, by turning on airplane mode during a window you want to hide).
 */
export type SubmitOutcome =
  | { kind: 'anchored'; txHash: string }
  | { kind: 'permanent'; reason: string } // can never be anchored; keep it on the device
  | { kind: 'transient'; reason: string }; // try again later, in order

export interface QueuedCheckpoint {
  merkleRoot: string;
  startTime: number;
}

export interface DrainResult<T> {
  anchored: { checkpoint: T; txHash: string }[];
  unanchored: { checkpoint: T; reason: string }[];
  /** Still queued: the first transient failure and everything after it. */
  remaining: T[];
}

export async function drainInOrder<T extends QueuedCheckpoint>(
  queue: T[],
  submitOne: (checkpoint: T) => Promise<SubmitOutcome>
): Promise<DrainResult<T>> {
  const ordered = [...queue].sort((a, b) => a.startTime - b.startTime);
  const result: DrainResult<T> = { anchored: [], unanchored: [], remaining: [] };
  for (let i = 0; i < ordered.length; i++) {
    const checkpoint = ordered[i]!;
    const outcome = await submitOne(checkpoint);
    if (outcome.kind === 'anchored') {
      result.anchored.push({ checkpoint, txHash: outcome.txHash });
    } else if (outcome.kind === 'permanent') {
      result.unanchored.push({ checkpoint, reason: outcome.reason });
    } else {
      result.remaining = ordered.slice(i);
      break;
    }
  }
  return result;
}

/** Contract errors that mean "this checkpoint can never be accepted", as opposed to "not yet". */
export const PERMANENT_REVERTS = new Set([
  'InvalidWindow',
  'OverlapsPrevious',
  'StaleCheckpoint',
  'ImpossibleDistance',
  'DistanceExceedsAverageSpeed',
  'InconsistentSpeeds',
  'InvalidSignature',
  'InvalidMerkleRoot',
  'NoRecords',
  'DeviceNotRegistered',
]);

/** The custom error name of a contract revert, if a viem error carries one. */
export function revertName(error: unknown): string | undefined {
  let current: any = error;
  for (let depth = 0; current && depth < 6; depth++) {
    const name = current.data?.errorName ?? current.errorName;
    if (typeof name === 'string') return name;
    current = current.cause;
  }
  return undefined;
}
