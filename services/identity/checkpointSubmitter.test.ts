// Run with: bun test services/identity
import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/p256';
import { hexToBytes, type Address, type Hex } from 'viem';
import { checkpointDigest, type CheckpointInput } from './checkpointDigest';
import { OutOfOrderCheckpointError, type ChainPosition } from './checkpointInput';
import { CheckpointSubmitter, StaleCheckpointError, type CheckpointChain } from './checkpointSubmitter';

const DEVICE = '0x1111111111111111111111111111111111111111' as Address;
const REGISTRY = '0x00000000000000000000000000000000000000aa' as Address;
const ZERO = `0x${'00'.repeat(32)}` as Hex;

const priv = p256.utils.randomPrivateKey();
const pub = p256.getPublicKey(priv, false);
/** Like the enclave: DER output, and not always low-s. */
const enclaveSigner = async (digest: Hex): Promise<Hex> => {
  const sig = p256.sign(hexToBytes(digest), priv, { lowS: false, prehash: false });
  return `0x${sig.toDERHex()}`;
};

/** A fake chain that enforces the same sequencing rules as the contract. */
class FakeChain implements CheckpointChain {
  chainId = 296;
  registry = REGISTRY;
  position: ChainPosition = { seq: 0n, prevRoot: ZERO, lastEndTime: 0n };
  sent: CheckpointInput[] = [];
  reads = 0;
  failNext = false;

  async readPosition() {
    this.reads++;
    return { ...this.position };
  }

  async sendCheckpoint(device: Address, input: CheckpointInput, r: Hex, s: Hex) {
    await new Promise((resolve) => setTimeout(resolve, 5)); // mining delay
    if (this.failNext) {
      this.failNext = false;
      throw new Error('reverted');
    }
    if (input.seq !== this.position.seq + 1n) throw new Error('OutOfSequence');
    if (input.prevRoot !== this.position.prevRoot) throw new Error('WrongPrevRoot');
    if (input.startTime < this.position.lastEndTime) throw new Error('OverlapsPrevious');
    const digest = checkpointDigest(this.chainId, this.registry, device, input);
    const sig = new p256.Signature(BigInt(r), BigInt(s));
    if (sig.hasHighS() || !p256.verify(sig, hexToBytes(digest), pub, { prehash: false })) throw new Error('InvalidSignature');

    this.sent.push(input);
    this.position = { seq: input.seq, prevRoot: input.merkleRoot, lastEndTime: input.endTime };
    return `0x${'ab'.repeat(32)}` as Hex;
  }
}

const NOW_MS = 1_763_294_400_000;
const checkpointAt = (offsetSeconds: number, rootByte: string) => ({
  merkleRoot: rootByte.repeat(32),
  startTime: NOW_MS + offsetSeconds * 1000,
  endTime: NOW_MS + (offsetSeconds + 30) * 1000,
  avgSpeed: 30,
  maxSpeed: 40,
  minSpeed: 20,
  distanceMeters: 400,
  recordCount: 30,
});

describe('CheckpointSubmitter', () => {
  const now = () => BigInt(NOW_MS / 1000 + 120);

  test('submissions that overlap in time are serialized into the right sequence', async () => {
    const chain = new FakeChain();
    const submitter = new CheckpointSubmitter(chain, enclaveSigner, now);

    // Fired back to back, the way the 30s timer can fire while a transaction is still mining.
    await Promise.all([
      submitter.submit(DEVICE, checkpointAt(0, '01')),
      submitter.submit(DEVICE, checkpointAt(30, '02')),
      submitter.submit(DEVICE, checkpointAt(60, '03')),
    ]);

    expect(chain.sent.map((c) => c.seq)).toEqual([1n, 2n, 3n]);
    expect(chain.sent[1]!.prevRoot).toBe(chain.sent[0]!.merkleRoot);
    expect(chain.sent[2]!.prevRoot).toBe(chain.sent[1]!.merkleRoot);
    expect(chain.reads).toBe(1); // position is tracked locally after the first read
  });

  test('signatures verify against the device key after low-s normalization', async () => {
    const chain = new FakeChain();
    const submitter = new CheckpointSubmitter(chain, enclaveSigner, now);
    for (let i = 0; i < 5; i++) await submitter.submit(DEVICE, checkpointAt(i * 30, `0${i + 1}`));
    expect(chain.sent).toHaveLength(5);
  });

  test('refuses to sign a checkpoint that can no longer land in the freshness window', async () => {
    const chain = new FakeChain();
    const late = () => BigInt(NOW_MS / 1000 + 30 + 600);
    const submitter = new CheckpointSubmitter(chain, enclaveSigner, late);
    await expect(submitter.submit(DEVICE, checkpointAt(0, '01'))).rejects.toBeInstanceOf(StaleCheckpointError);
    expect(chain.sent).toHaveLength(0);
  });

  test('regression (seen on device): an old queued checkpoint retried after newer ones is not relabeled', async () => {
    const chain = new FakeChain();
    const submitter = new CheckpointSubmitter(chain, enclaveSigner, now);
    await submitter.submit(DEVICE, checkpointAt(60, '02'));
    await submitter.submit(DEVICE, checkpointAt(90, '03'));
    // The retry queue then sends a checkpoint recorded earlier, at 0-30s.
    await expect(submitter.submit(DEVICE, checkpointAt(0, '01'))).rejects.toBeInstanceOf(OutOfOrderCheckpointError);
    expect(chain.sent.map((c) => c.merkleRoot.slice(2, 4))).toEqual(['02', '03']);
  });

  test('freshness is judged on the recorded window, not an adjusted one', async () => {
    const chain = new FakeChain();
    chain.position = { seq: 3n, prevRoot: ZERO, lastEndTime: BigInt(NOW_MS / 1000 + 700) };
    const later = () => BigInt(NOW_MS / 1000 + 700);
    const submitter = new CheckpointSubmitter(chain, enclaveSigner, later);
    // Recorded at 0-30s, now 700s later: stale, regardless of where the chain head is.
    await expect(submitter.submit(DEVICE, checkpointAt(0, '01'))).rejects.toBeInstanceOf(StaleCheckpointError);
    expect(chain.sent).toHaveLength(0);
  });

  test('after a failed submission it re-reads the chain and recovers', async () => {
    const chain = new FakeChain();
    const submitter = new CheckpointSubmitter(chain, enclaveSigner, now);
    await submitter.submit(DEVICE, checkpointAt(0, '01'));
    chain.failNext = true;
    await expect(submitter.submit(DEVICE, checkpointAt(30, '02'))).rejects.toThrow('reverted');
    await submitter.submit(DEVICE, checkpointAt(60, '03'));
    expect(chain.sent.map((c) => c.seq)).toEqual([1n, 2n]);
    expect(chain.reads).toBe(2);
  });
});
