// Run with: bun test services
import { describe, expect, test } from 'bun:test';
import { isSealed, openSealed, seal } from './sealedBox';

const key = crypto.getRandomValues(new Uint8Array(32));
const nonce = () => crypto.getRandomValues(new Uint8Array(24));
const records = JSON.stringify([{ timestamp: 1763294400000, latitude: 43.653226, longitude: -79.383184, speed: 31.5 }]);

describe('sealed box', () => {
  test('round-trips a value, and the stored text contains no plaintext', () => {
    const sealed = seal(key, 'speed_records', records, nonce());
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('43.653226');
    expect(openSealed(key, 'speed_records', sealed)).toBe(records);
  });

  test('round-trips non-ASCII text', () => {
    const text = JSON.stringify({ note: 'café — 東京 🚗' });
    expect(openSealed(key, 'slot', seal(key, 'slot', text, nonce()))).toBe(text);
  });

  test('uses a fresh nonce, so equal values encrypt differently', () => {
    expect(seal(key, 'slot', records, nonce())).not.toBe(seal(key, 'slot', records, nonce()));
  });

  test('fails with the wrong key', () => {
    const sealed = seal(key, 'speed_records', records, nonce());
    expect(() => openSealed(crypto.getRandomValues(new Uint8Array(32)), 'speed_records', sealed)).toThrow();
  });

  test('fails if the ciphertext is modified', () => {
    const sealed = seal(key, 'speed_records', records, nonce());
    const i = sealed.length - 10;
    const tampered = sealed.slice(0, i) + (sealed[i] === 'A' ? 'B' : 'A') + sealed.slice(i + 1);
    expect(() => openSealed(key, 'speed_records', tampered)).toThrow();
  });

  test('fails if a value is moved to a different slot', () => {
    const sealed = seal(key, 'records_0xaaaa', records, nonce());
    expect(() => openSealed(key, 'records_0xbbbb', sealed)).toThrow();
  });
});
