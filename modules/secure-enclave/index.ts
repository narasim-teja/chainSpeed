import { requireNativeModule } from 'expo';

type Hex = `0x${string}`;

interface SecureEnclaveNativeModule {
  isSupported(): boolean;
  /** Creates (replacing any existing) a non-exportable P-256 key. Returns 0x04 ‖ x ‖ y. */
  createKey(tag: string, requireBiometry: boolean): Promise<Hex>;
  getPublicKey(tag: string): Hex | null;
  deleteKey(tag: string): boolean;

  /** Face ID once per drive; the authenticated context is reused for every signature. */
  beginSession(reason: string): Promise<void>;
  endSession(): void;
  hasSession(): boolean;
  /** ECDSA P-256 over a 32-byte digest, returned DER-encoded. */
  sign(tag: string, digestHex: Hex): Promise<Hex>;

  isAppAttestSupported(): boolean;
  /** Returns the App Attest key identifier (base64). */
  generateAppAttestKey(): Promise<string>;
  /** Returns the attestation object (base64). `clientDataHash` is base64 of 32 bytes. */
  attestKey(keyId: string, clientDataHashBase64: string): Promise<string>;
}

export default requireNativeModule<SecureEnclaveNativeModule>('SecureEnclave');
