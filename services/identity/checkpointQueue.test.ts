// Run with: bun test services
import { describe, expect, test } from 'bun:test';
import { drainInOrder, revertName, type SubmitOutcome } from './checkpointQueue';

const cp = (root: string, startTime: number) => ({ merkleRoot: root, startTime });

describe('drainInOrder', () => {
  test('second review: a transient failure stops the drain, so a newer checkpoint cannot overtake it', async () => {
    const sent: string[] = [];
    const result = await drainInOrder([cp('c', 60), cp('a', 0), cp('b', 30)], async (c): Promise<SubmitOutcome> => {
      sent.push(c.merkleRoot);
      return c.merkleRoot === 'b' ? { kind: 'transient', reason: 'rpc down' } : { kind: 'anchored', txHash: `tx-${c.merkleRoot}` };
    });
    expect(sent).toEqual(['a', 'b']); // oldest first; 'c' was never attempted
    expect(result.anchored.map((r) => r.checkpoint.merkleRoot)).toEqual(['a']);
    expect(result.remaining.map((r) => r.merkleRoot)).toEqual(['b', 'c']);
  });

  test('a permanent failure is set aside and the drain continues', async () => {
    const result = await drainInOrder([cp('a', 0), cp('b', 30)], async (c): Promise<SubmitOutcome> =>
      c.merkleRoot === 'a' ? { kind: 'permanent', reason: 'stale' } : { kind: 'anchored', txHash: 'tx-b' }
    );
    expect(result.unanchored).toEqual([{ checkpoint: cp('a', 0), reason: 'stale' }]);
    expect(result.anchored.map((r) => r.checkpoint.merkleRoot)).toEqual(['b']);
    expect(result.remaining).toEqual([]);
  });
});

describe('revertName', () => {
  test('finds a custom error name nested in viem-style causes', () => {
    const error = { shortMessage: 'reverted', cause: { cause: { data: { errorName: 'StaleCheckpoint' } } } };
    expect(revertName(error)).toBe('StaleCheckpoint');
    expect(revertName(new Error('network down'))).toBeUndefined();
  });
});
