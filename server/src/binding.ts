import { concat, fromHex, sha256 } from "./bytes";

/**
 * The value the app passes to `DCAppAttestService.attestKey(_:clientDataHash:)`
 * during registration. Hashing the server challenge, the Secure Enclave public
 * key and the wallet address into it is what ties Apple's statement about the
 * device to this specific signing key and this specific wallet: an attestation
 * made for one key or wallet cannot be used to register another.
 *
 *   clientDataHash = SHA-256( challenge (32 bytes)
 *                           ‖ enclavePublicKey (65 bytes, 0x04 ‖ x ‖ y)
 *                           ‖ wallet (20 bytes) )
 *
 * The app must build exactly the same bytes.
 */
export function registrationClientDataHash(
  challenge: Uint8Array,
  enclavePublicKey: Uint8Array,
  wallet: `0x${string}`
): Uint8Array {
  if (challenge.length !== 32) throw new Error("Challenge must be 32 bytes");
  if (enclavePublicKey.length !== 65 || enclavePublicKey[0] !== 0x04) {
    throw new Error("Enclave public key must be an uncompressed P-256 point (65 bytes)");
  }
  const walletBytes = fromHex(wallet);
  if (walletBytes.length !== 20) throw new Error("Wallet must be a 20-byte address");
  return sha256(concat(challenge, enclavePublicKey, walletBytes));
}
