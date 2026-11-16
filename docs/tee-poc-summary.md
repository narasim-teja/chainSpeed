# Secure Enclave (TEE) signing: actual status

> **Correction (November 2026).** An earlier version of this document claimed a working Secure Enclave implementation ("not a simulation", "Apple-signed certificates prove key authenticity", "ready for hackathon demonstration"). Those claims were wrong. The earlier version is in git history; this page replaces it with what the code actually does.

## What `services/TEECryptoService.ts` does today

| Claimed | Actual |
| --- | --- |
| Generates a key pair in the Secure Enclave | Stores the literal placeholder string `secure-key-material` in the Keychain via `react-native-keychain`. No key pair is created. |
| Extracts the public key from the enclave | Derives a 130-character "public key" by SHA-256 hashing constants from the source code. It is identical on every install, and anyone can recompute it. |
| ECDSA signatures with `r,s` components | Two SHA-256 hashes over the record, key alias, public key and a timestamp, concatenated and prefixed `TEE-HW:`. Anyone can produce these. |
| Signature verification | `verifyTEESignature` checks only length, hex format and the prefix of the "public key". Nothing in the app calls it. |
| Face ID required for signing | One biometric prompt unlocks a 30-minute session. After that, signing is gated by an in-memory boolean and never touches the Keychain. |
| Apple attestation | Not implemented. No App Attest, no DeviceCheck, no certificate validation. |
| Tamper-proof record chaining | Each record includes the previous record's hash, but the chain head lives only in memory, resets on app restart, and is never anchored on chain or verified. |
| Software fallback for unsupported devices | Exists, and is silent: records are marked `SW:` but are treated as valid downstream. |

The iPhone 14 log in the earlier version was real output, but the public key it showed (`04a4acb6...`) is the hash of source constants described above, not a hardware key.

## What a real implementation needs

1. **A real Secure Enclave key.** A small native module calling `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave` and an access control of `biometryCurrentSet` (or `userPresence`). Sign with `SecKeyCreateSignature` using `ecdsaSignatureMessageX962SHA256`. Export the public key and verify ECDSA P-256 off device.
2. **Attestation and registration.** Use Apple App Attest to show the key belongs to a genuine device running this app, verified server-side against Apple's root, and bind the key to the user's account.
3. **Freshness.** Use a server-issued nonce per session inside every signed payload, plus a monotonic per-device sequence number, so records can't be backdated or replayed.
4. **Signed checkpoints.** Sign each checkpoint (Merkle root, time window, stats, nonce, chain ID) with the enclave key, and verify that signature on chain or in a verifier service before accepting it.
5. **Fail closed.** If hardware signing is unavailable, mark data as unverified and exclude it from rewards and proofs, rather than silently falling back.

Even with all of the above, the enclave signs whatever the app hands it. A modified app or spoofed location can still produce signed false data, which is why App Attest and server-side checks matter as much as the key itself.
