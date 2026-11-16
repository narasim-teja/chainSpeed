import type { Address, Hex } from 'viem';
import { checkpointDigest, type CheckpointInput } from './checkpointDigest';
import { recordedWindow, toCheckpointInput, type ChainPosition, type LocalCheckpoint } from './checkpointInput';
import { derSignatureToRS } from './signature';

/** SpeedRegistry.MAX_SUBMIT_DELAY. */
export const MAX_SUBMIT_DELAY_SECONDS = 600;
/** Don't start a submission that would likely land after the deadline. */
const SUBMIT_SAFETY_MARGIN_SECONDS = 30;

export interface CheckpointChain {
  chainId: number;
  registry: Address;
  readPosition(device: Address): Promise<ChainPosition>;
  /** Sends submitCheckpoint and resolves once it is mined successfully; throws on revert. */
  sendCheckpoint(device: Address, input: CheckpointInput, r: Hex, s: Hex): Promise<Hex>;
}

/** Signs a 32-byte digest with the device's enclave key; returns a DER signature. */
export type DigestSigner = (digest: Hex) => Promise<Hex>;

/** The checkpoint can no longer land within the contract's freshness window. */
export class StaleCheckpointError extends Error {
  constructor(readonly endTime: bigint) {
    super(`Checkpoint ended at ${endTime} and is past the ${MAX_SUBMIT_DELAY_SECONDS}s submission window`);
    this.name = 'StaleCheckpointError';
  }
}

/**
 * Signs and submits checkpoints one at a time. Each submission is signed only
 * when it is about to be sent, chained to the position the previous one left,
 * so checkpoints can never race each other into the wrong sequence.
 */
export class CheckpointSubmitter {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly positions = new Map<string, ChainPosition>();

  constructor(
    private readonly chain: CheckpointChain,
    private readonly sign: DigestSigner,
    private readonly nowSeconds: () => bigint = () => BigInt(Math.floor(Date.now() / 1000))
  ) {}

  submit(device: Address, local: LocalCheckpoint): Promise<Hex> {
    const run = this.tail.then(() => this.submitNow(device, local));
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Forget cached positions, e.g. after the device key is re-registered. */
  reset() {
    this.positions.clear();
  }

  private async submitNow(device: Address, local: LocalCheckpoint): Promise<Hex> {
    // Freshness is judged on the window as recorded, before anything else touches it.
    const recordedEnd = recordedWindow(local).endTime;
    const deadline = recordedEnd + BigInt(MAX_SUBMIT_DELAY_SECONDS - SUBMIT_SAFETY_MARGIN_SECONDS);
    if (this.nowSeconds() > deadline) throw new StaleCheckpointError(recordedEnd);

    const key = device.toLowerCase();
    const position = this.positions.get(key) ?? (await this.chain.readPosition(device));
    const input = toCheckpointInput(local, position); // throws OutOfOrderCheckpointError for old windows

    const digest = checkpointDigest(this.chain.chainId, this.chain.registry, device, input);
    const { r, s } = derSignatureToRS(await this.sign(digest));

    try {
      const hash = await this.chain.sendCheckpoint(device, input, r, s);
      this.positions.set(key, { seq: input.seq, prevRoot: input.merkleRoot, lastEndTime: input.endTime });
      return hash;
    } catch (error) {
      // Our view of the chain may be wrong; re-read it next time.
      this.positions.delete(key);
      throw error;
    }
  }
}
