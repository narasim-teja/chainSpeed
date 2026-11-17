// Run with: bun test services
// Regression test from the third independent review: a checkpoint queued while another drain
// was in flight used to be erased (never sent, never marked unanchored).
import { mock, test, expect } from 'bun:test';
import { join } from 'node:path';

const store = new Map<string, string>();
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
    multiSet: async (kv: [string, string][]) => kv.forEach(([k, v]) => store.set(k, v)),
    multiRemove: async (ks: string[]) => ks.forEach((k) => store.delete(k)),
    getAllKeys: async () => [...store.keys()],
  },
}));
mock.module('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => store.get('ss:' + k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set('ss:' + k, v),
}));
mock.module('expo-crypto', () => ({ getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }));
mock.module(join(import.meta.dir, '..', 'modules', 'secure-enclave', 'index.ts'), () => ({
  default: { hasSession: () => true, sign: async () => '0x' },
}));
mock.module('expo', () => ({ requireNativeModule: () => ({ hasSession: () => true }) }));

const DEVICE = '0x1111111111111111111111111111111111111111';
const cp = (c: string, t: number) => ({
  merkleRoot: '0x' + c.repeat(64), startTime: t, endTime: t + 30_000,
  avgSpeed: 1, maxSpeed: 1, minSpeed: 1, distanceMeters: 1, recordCount: 1, device: DEVICE,
});

test('a checkpoint queued while a drain is in flight is still sent, in order', async () => {
  const { getBlockchainService } = await import('./BlockchainService');
  const bs: any = getBlockchainService();
  bs.getConnectedAddress = async () => DEVICE;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const sent: string[] = [];
  bs.submitOne = async (_d: string, c: any) => {
    sent.push(c.merkleRoot.slice(2, 3));
    if (c.merkleRoot.endsWith('a')) await gate;
    return { kind: 'anchored', txHash: 'tx-' + c.merkleRoot.slice(2, 3) };
  };

  await bs.storePendingCheckpoint(cp('a', 0));
  const retry = bs.retryPendingCheckpoints(); // e.g. the retry at Stop
  await new Promise((r) => setTimeout(r, 10));
  const submit = bs.submitCheckpoint(cp('b', 30_000)); // the 30 s timer fires meanwhile
  await new Promise((r) => setTimeout(r, 10));
  release();
  await retry;

  expect(await submit).toBe('tx-b');
  expect(sent).toEqual(['a', 'b']);
  expect(await bs.getPendingCheckpoints()).toEqual([]);
});

test('a checkpoint recorded for a different wallet is set aside, not signed for this one', async () => {
  const { getBlockchainService } = await import('./BlockchainService');
  const bs: any = getBlockchainService();
  bs.getConnectedAddress = async () => DEVICE;
  const sent: string[] = [];
  bs.submitOne = async (_d: string, c: any) => (sent.push(c.merkleRoot), { kind: 'anchored', txHash: 'tx' });
  const result = await bs.submitCheckpoint({ ...cp('c', 60_000), device: '0x2222222222222222222222222222222222222222' });
  expect(result).toBeNull();
  expect(sent).toEqual([]);
  const unanchored = await bs.getUnanchoredCheckpoints();
  expect(unanchored.at(-1).reason).toBe('Recorded for a different wallet');
});
