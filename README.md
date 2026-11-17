# ChainSpeed

> **Hackathon prototype (August 2025), testnet only.** ChainSpeed explores whether a phone can produce tamper-evident driving-speed records, anchor them on chain, and reward safe driving. Earlier versions of this README claimed security properties that were never implemented. After an external security review in November 2026, the core of it was rebuilt; the current state, including what is still missing, is described below. **This is not legal evidence and should not be used as a source of truth.**

## Status at a glance

What was rebuilt is covered by tests and was verified end to end on an iPhone 14 (iOS 26) against Hedera testnet. The full finding-by-finding record, including a second independent review, is in [docs/security-triage.md](docs/security-triage.md).

| Area | What works | Known limits |
| --- | --- | --- |
| Device key | A non-exportable P-256 key in the Secure Enclave (`modules/secure-enclave`) signs every checkpoint. The OS enforces Face ID on the key once per drive; a session lasts at most 4 hours | The enclave signs whatever the app's JavaScript hands it. Signing while the phone is locked mid-drive is untested |
| Registration | Apple App Attest is verified by the registrar (`server/`) against Apple's root, bound to the enclave key and the user's Privy wallet; the key is then registered on chain | App Attest vouches for the native app, not the JavaScript it runs, and only the development environment has been exercised. The registrar is trusted, and attestations aren't published |
| Checkpoints | `SpeedRegistry` verifies each checkpoint's signature against the registered key. It enforces sequence and chaining, freshness against block time, window length, and distance consistent with the window's average speed. Lookups are per device | Times and speeds come from the device. A device can omit a window. About 535k gas per checkpoint (roughly 0.8 testnet HBAR, estimated from on-device testing) |
| Record proofs | Every record is a leaf (bound to the device, salted) in an OpenZeppelin standard Merkle tree. `verifyRecord` checks a record's inclusion and that its time is inside the checkpoint's window | `recordCount` is a signed claim, not derived from the tree |
| XP | Computed on chain only from signed checkpoints, in bounded batches, with a daily cap. Redemption burns XP and records a request | Gift-card fulfillment is not built, so no codes are issued |
| Privacy | Records are encrypted at rest (XChaCha20-Poly1305, key in the Keychain, this device only). Proof records are kept 30 days. No geocoding, no coordinates in logs | Each checkpoint's window, speed stats and distance are public on chain and linked to the wallet. Leaves commit to precise coordinates |
| Recording | GPS once per second while a drive is running and the app is open | **No background recording.** Background location is not enabled, so recording stops when the app is not in the foreground |
| Network | App Transport Security is on; plain HTTP is allowed only to local-network hosts (in every build, for development) | A production registrar must use HTTPS |
| Not built | — | Android, gift-card fulfillment, city-level aggregation, user-chosen retention, gasless transactions, multi-chain |

## Original idea

Drivers often have no independent record of their own speed. ChainSpeed's goal:

1. Record speed on the phone, signed by a hardware key the user cannot extract.
2. Commit batches of records to a public chain so they cannot be quietly changed later.
3. Let the driver reveal a specific window with a Merkle proof, without exposing their whole history.
4. Reward safe driving with XP.

Steps 1–3 now work as described in [docs/identity-design.md](docs/identity-design.md), within the limits above.

## Smart contract deployments (Hedera testnet)

- **SpeedRegistry** (current): [`0xA34977f6A891AF559f1038E1EA10122687281A89`](https://hashscan.io/testnet/contract/0xA34977f6A891AF559f1038E1EA10122687281A89)
- **XPRewards** (current, reads the registry above): [`0x515e82ca4bb8F5F171F513546cEaCeFe6E6b2F4E`](https://hashscan.io/testnet/contract/0x515e82ca4bb8F5F171F513546cEaCeFe6E6b2F4E)
- Earlier versions, kept for the record:
  - SpeedRegistry v1, unsigned (the reviewed version): `0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8`
  - First signed registry, which holds the three relabeled checkpoints described in the triage: `0xcDD3887eCc5C56417DE280cc562aB78687296b39`
  - Second-review version (distance bounded by max speed, since replaced): `0xc1b26022DDea38072E776b8e02c5a5B8DFBC0686`
  - The Zircuit testnet contracts are v1 and are not used.

## How it works

1. **Sign-up:** the user logs in with Privy (email), which creates an embedded wallet. "Register this device" creates the enclave key, has Apple attest the app bound to that key and wallet, and the registrar registers the key on chain.
2. **Drive:** "Start Drive" asks for Face ID once. `LocationService` records GPS every second. Records are encrypted at rest.
3. **Checkpoints:** every 30 seconds `MerkleService` builds a tree over the new records. The enclave signs the checkpoint (root, window, stats, sequence, previous root), and `BlockchainService` submits it. Submissions go strictly oldest first. Checkpoints that can never be anchored are kept on the device as "unanchored".
4. **Proofs:** the Profile screen reads the signed checkpoints for a time range from chain and verifies a record from each with `verifyRecord`. It shows how much of the range is actually anchored and how many gaps there are; a gap looks the same as not driving.
5. **XP:** after a drive, `XPRewards` turns new checkpoints into XP: 1 XP per safe mile (average speed at or under 75 mph), accumulated in meters.

## Repository

```
chainspeed/
├── app/, components/            # Expo Router screens and UI
├── modules/secure-enclave/      # Swift: enclave key, Face ID session, App Attest
├── services/
│   ├── identity/                # registration, checkpoint digest, signing, queue, record tree
│   ├── storage/                 # encryption at rest, retention
│   ├── LocationService.ts       # GPS recording
│   ├── MerkleService.ts         # 30-second checkpoints and proofs
│   ├── BlockchainService.ts     # Hedera contract calls
│   └── SpeedTrackingService.ts  # orchestration
├── server/                      # device registrar (Bun + Hono): App Attest, Privy, registration
├── contracts/                   # SpeedRegistry, XPRewards, tests, deploy scripts
└── docs/                        # triage, identity design, and original hackathon notes
```

## Development

| Piece | Tests |
| --- | --- |
| Contracts | `cd contracts && bunx hardhat test` |
| Registrar | `cd server && bun test` (includes a real attestation captured from an iPhone) |
| App logic | `bun test services` |
| Secure Enclave module | Physical device only |

After changing a contract, run `bun scripts/export-abi.ts` in `contracts/` to regenerate the app's ABIs.

To run end to end:

1. **Deploy the contracts.** `REGISTRAR_ADDRESS=0x... bun run deploy:hedera-testnet`, then `SPEED_REGISTRY_ADDRESS=0x... bun run deploy:hedera-testnet-xp-rewards` (in `contracts/`, with `PRIVATE_KEY` set).
2. **Start the registrar.** `cp server/.env.example server/.env`, fill it in, then `cd server && bun run dev`.
3. **Configure Privy.** In the Privy dashboard, enable "Return user data in an identity token", and add an app client allowing the bundle ID `com.narasimha.chainspeed`.
4. **Configure the app.** `cp .env.example .env.local`, then set the contract addresses and the registrar URL.
5. **Build to a physical iPhone.** `bunx expo run:ios --device`. Neither the Secure Enclave nor App Attest works in the simulator.

**Path with spaces:** React Native's codegen build step fails if the project path contains a space. Build from a path without spaces.
