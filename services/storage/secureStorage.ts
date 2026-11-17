import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { KEY_BYTES, NONCE_BYTES, isSealed, openSealed, seal } from './sealedBox';

/**
 * JSON storage encrypted at rest (F13). Values live in AsyncStorage as sealed boxes; the key
 * lives in the iOS Keychain, readable after first unlock (so tracking works with the phone
 * locked) and never synced or backed up (ThisDeviceOnly). A backup of the app's files is
 * therefore ciphertext without its key.
 */
const KEY_NAME = 'chainspeed.storage-key.v1';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let keyPromise: Promise<Uint8Array> | null = null;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

function storageKey(): Promise<Uint8Array> {
  // One promise for the whole app, so concurrent first writes cannot create two keys.
  keyPromise ??= (async () => {
    const existing = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
    if (existing) return fromHex(existing);
    const key = Crypto.getRandomBytes(KEY_BYTES);
    await SecureStore.setItemAsync(KEY_NAME, toHex(key), KEY_OPTIONS);
    return key;
  })().catch((error) => {
    keyPromise = null;
    throw error;
  });
  return keyPromise;
}

/**
 * Reads a value. Legacy plaintext values are still readable and get encrypted on their next write.
 *
 * A sealed value that cannot be opened (for example after restoring a backup onto another
 * phone: the key is ThisDeviceOnly and is not restored) is moved aside to `<slot>.unreadable`
 * and treated as absent. Otherwise every later read-modify-write of that slot would fail forever.
 */
export async function getSecureJSON<T>(slot: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(slot);
  if (raw == null) return null;
  if (!isSealed(raw)) return JSON.parse(raw) as T;
  const key = await storageKey();
  try {
    return JSON.parse(openSealed(key, slot, raw)) as T;
  } catch (error) {
    console.warn(`Stored value for ${slot} cannot be decrypted with this device's key; setting it aside`);
    await AsyncStorage.multiSet([[`${slot}.unreadable`, raw]]);
    await AsyncStorage.removeItem(slot);
    return null;
  }
}

export async function setSecureJSON(slot: string, value: unknown): Promise<void> {
  const sealed = seal(await storageKey(), slot, JSON.stringify(value), Crypto.getRandomBytes(NONCE_BYTES));
  await AsyncStorage.setItem(slot, sealed);
}
