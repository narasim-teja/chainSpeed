import * as SecureStore from 'expo-secure-store';
import { concat, hexToBytes, sha256, type Address, type Hex } from 'viem';
import SecureEnclave from '../../modules/secure-enclave';
import { IDENTITY_CONFIG } from '../../constants/Blockchain';

/** Keychain tag of the first registration's key; later registrations get their own tag. */
export const SIGNING_KEY_TAG = 'com.narasimha.chainspeed.checkpoint-signing.v2';
const SIGNING_KEY_TAG_PREFIX = 'com.narasimha.chainspeed.checkpoint-signing.v2.';

/** The tag of the key currently registered on chain (set when an identity is loaded or created). */
let activeKeyTag: string = SIGNING_KEY_TAG;
const STATE_KEY = 'chainspeed.deviceIdentity.v2';

export interface DeviceIdentity {
  wallet: Address;
  keyTag?: string; // absent for the first registration, which used SIGNING_KEY_TAG
  enclavePublicKey: Hex;
  appAttestKeyId: string;
  keyHash: Hex;
  txHash: Hex;
  environment: string;
  registeredAt: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Same bytes as the server's registrationClientDataHash: SHA-256(challenge ‖ enclave key ‖ wallet). */
function registrationClientDataHash(challenge: string, enclavePublicKey: Hex, wallet: Address): Uint8Array {
  return sha256(concat([base64ToBytes(challenge), hexToBytes(enclavePublicKey), hexToBytes(wallet)]), 'bytes');
}

/**
 * The registered identity for `wallet`, if this device has one and its enclave key still exists.
 * (The key disappears if the user changes their enrolled Face ID, because of biometryCurrentSet.)
 */
export async function getDeviceIdentity(wallet: Address): Promise<DeviceIdentity | null> {
  const stored = await SecureStore.getItemAsync(STATE_KEY);
  if (!stored) return null;
  const identity = JSON.parse(stored) as DeviceIdentity;
  if (identity.wallet.toLowerCase() !== wallet.toLowerCase()) return null;
  const tag = identity.keyTag ?? SIGNING_KEY_TAG;
  const currentKey = SecureEnclave.getPublicKey(tag);
  if (!currentKey || currentKey.toLowerCase() !== identity.enclavePublicKey.toLowerCase()) return null;
  activeKeyTag = tag;
  return identity;
}

export function isDeviceSupported(): boolean {
  return SecureEnclave.isSupported() && SecureEnclave.isAppAttestSupported();
}

/**
 * Creates the enclave signing key, has Apple attest it bound to (challenge, key, wallet),
 * and asks the registrar to register it on chain. See docs/identity-design.md.
 */
export async function registerDevice(
  wallet: Address,
  getIdentityToken: () => Promise<string | null>
): Promise<DeviceIdentity> {
  if (!isDeviceSupported()) {
    throw new Error('This device does not support the Secure Enclave and App Attest, so it cannot sign checkpoints.');
  }
  if (!IDENTITY_CONFIG.registrarUrl) throw new Error('EXPO_PUBLIC_REGISTRAR_URL is not set');

  // A new key under its own tag: any existing key keeps working until this one is registered.
  const keyTag = SIGNING_KEY_TAG_PREFIX + Date.now();
  const enclavePublicKey = await SecureEnclave.createKey(keyTag, true);

  const challengeRes = await fetch(`${IDENTITY_CONFIG.registrarUrl}/v1/challenge`, { method: 'POST' });
  if (!challengeRes.ok) throw new Error(`Could not get a registration challenge (${challengeRes.status})`);
  const { challenge } = (await challengeRes.json()) as { challenge: string };

  const keyId = await SecureEnclave.generateAppAttestKey();
  const clientDataHash = registrationClientDataHash(challenge, enclavePublicKey, wallet);
  const attestation = await SecureEnclave.attestKey(keyId, bytesToBase64(clientDataHash));

  if (__DEV__) {
    // Paste into server/test/fixtures/real-attestation.json (add "appId") to test the
    // server's verifier against a real device and Apple's real root.
    console.log(
      'App Attest fixture:',
      JSON.stringify({
        keyId,
        attestation,
        clientDataHash: bytesToBase64(clientDataHash),
        capturedAt: new Date().toISOString(),
      })
    );
  }

  const identityToken = await getIdentityToken();
  if (!identityToken) throw new Error('No Privy identity token. Enable identity tokens in the Privy dashboard.');

  const res = await fetch(`${IDENTITY_CONFIG.registrarUrl}/v1/devices/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'privy-id-token': identityToken },
    body: JSON.stringify({ challenge, keyId, attestation, enclavePublicKey, wallet }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Delete the new key only when the server definitively rejected it. On a 5xx the registry may
    // already hold it (the transaction can land after the server gave up waiting); the Track
    // screen compares the local key with the chain and asks to register again if they differ.
    if (res.status >= 400 && res.status < 500) SecureEnclave.deleteKey(keyTag);
    throw new Error(`Device registration failed (${res.status}): ${JSON.stringify(body)}`);
  }

  const previous = await SecureStore.getItemAsync(STATE_KEY);
  const identity: DeviceIdentity = {
    wallet,
    keyTag,
    enclavePublicKey,
    appAttestKeyId: keyId,
    keyHash: body.keyHash,
    txHash: body.txHash,
    environment: body.environment,
    registeredAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(identity));
  activeKeyTag = keyTag;
  // The on-chain key is now the new one, so the old key can no longer sign anything accepted.
  if (previous) {
    const oldTag = (JSON.parse(previous) as DeviceIdentity).keyTag ?? SIGNING_KEY_TAG;
    if (oldTag !== keyTag) SecureEnclave.deleteKey(oldTag);
  }
  return identity;
}

/** Face ID once at the start of a drive. */
export function beginDriveSession(): Promise<void> {
  return SecureEnclave.beginSession('Unlock your signing key for this drive');
}

export function endDriveSession() {
  SecureEnclave.endSession();
}

export function hasDriveSession(): boolean {
  return SecureEnclave.hasSession();
}

/** Signs a checkpoint digest with the enclave key (requires an active drive session). */
export function signWithDeviceKey(digest: Hex): Promise<Hex> {
  return SecureEnclave.sign(activeKeyTag, digest);
}
