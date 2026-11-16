# ChainSpeed

> **Hackathon prototype (August 2025).** ChainSpeed set out to explore whether a phone could produce tamper-evident driving-speed records, anchor them on chain, and reward safe driving. It was an ambitious build for the time available, and **several security properties described in earlier versions of this README were never implemented.** The current state is described honestly below. Do not use this app as evidence or as a source of truth for anything.

## Status at a glance

An independent security review in November 2026 found that the trust model was not real. Device identity and signed checkpoints (Tier 1 of the [triage](docs/security-triage.md)) have since been rebuilt and verified on a physical iPhone against Hedera testnet; the rest is still open. The table separates what works from what is missing.

| Area | What works today | What is simulated or missing |
| --- | --- | --- |
| Speed tracking | GPS + motion sensors sampled every second; records batched into 30-second checkpoints | Timestamps come from the device clock. The contract bounds them (a checkpoint must land within 10 minutes of its window, in sequence), but a modified app can still sign false times or locations |
| Secure Enclave signing | A non-exportable P-256 key in the Secure Enclave (`modules/secure-enclave`) signs every checkpoint. Face ID once per drive, enforced by the OS on the key | Individual records are only software hash-chained; the checkpoint signature over their Merkle root is the evidence boundary. Signing while the phone is locked mid-drive is untested |
| Device attestation | Apple App Attest at registration, verified by the registrar (`server/`) against Apple's root, binding the enclave key to the user's Privy wallet; the key is then registered on chain | No per-session App Attest assertions yet; Android is unsupported |
| On-chain checkpoints (Hedera testnet) | `SpeedRegistry` v2 verifies each checkpoint's P-256 signature against the registered key, and enforces sequence, chaining to the previous root, freshness, window length and plausible distance | `checkpointByRoot` can still be overwritten by another device (F5); about 0.9 testnet HBAR per checkpoint |
| Merkle proofs | Trees are built on device | The app hashes with SHA-256 and the contract verifies with keccak256, so app-generated proofs cannot verify on chain |
| XP rewards | `XPRewards` contract computes XP from submitted checkpoints | XP inputs are unverified client data; "gift card" codes are mock strings with no fulfillment |
| Multi-chain | Contracts were also deployed to Zircuit testnet | The app only talks to Hedera; the Zircuit deployment is not reachable from the app |
| Gas | Privy embedded wallets | Not gasless: the user's wallet pays gas (testnet HBAR from the faucet) |
| Privacy | Raw data stays on device | Records are stored as plaintext JSON with precise GPS coordinates; city-level aggregation is a stub |
| Legal evidence | — | Not court-admissible. Signer identity and attestation now exist, but inclusion proofs still cannot verify (F3), local records are deleted after 24 hours, and the enclave signs whatever the app hands it |

Remaining work is tracked in the [triage](docs/security-triage.md): contract fixes (Tier 2) and privacy and fail-closed behavior (Tier 3).

## Original idea

Drivers often have no independent record of their own speed. ChainSpeed's goal was:

1. Record speed on the phone, signed by a hardware-protected key the user cannot extract.
2. Commit batches of records to a public chain so they cannot be quietly changed later.
3. Let the driver reveal a specific window (with a Merkle proof) when they need to, without exposing their whole history.
4. Reward safe driving with XP, and use anonymized city-level data to fund those rewards.

Steps 1 and 3 are the hard parts. Step 1 is now real ([docs/identity-design.md](docs/identity-design.md)); step 3 needs one consistent hashing scheme between client and contract (F3, Tier 2).

## Smart contract deployments (testnets)

### Hedera Testnet (used by the app)

- **SpeedRegistry v2** (signed checkpoints): [`0xcDD3887eCc5C56417DE280cc562aB78687296b39`](https://hashscan.io/testnet/contract/0xcDD3887eCc5C56417DE280cc562aB78687296b39)
- **XPRewards**: [`0x7224Cf802c4e6bDE9e67C8Eec2673dB85B0B7816`](https://hashscan.io/testnet/contract/0x7224Cf802c4e6bDE9e67C8Eec2673dB85B0B7816) (still reads the v1 registry; redeployed in Tier 2)
- SpeedRegistry v1 (unsigned, superseded): [`0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8`](https://hashscan.io/testnet/contract/0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8)

### Zircuit Testnet (deployed, not wired into the app)

- **SpeedRegistry**: [`0xC1768e08130BA10305064DbA76C57E890B270b3F`](https://explorer.testnet.zircuit.com/address/0xC1768e08130BA10305064DbA76C57E890B270b3F)
- **XPRewards**: [`0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8`](https://explorer.testnet.zircuit.com/address/0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8)

The Zircuit contracts are v1 and match the review's findings.

## Quick start

### Prerequisites

- Node.js 18+
- An iOS device for the full flow (the app falls back to software hashing on simulators)
- [Bun](https://bun.sh) 1.4+

### Install and run

```bash
git clone https://github.com/narasim-teja/chainSpeed.git
cd chainSpeed
bun install
bun run start   # dev server
bun run ios     # run on iOS
```

### Configuration

The app reads its Privy app ID and client ID from `app.json`. To run against your own Privy app, replace them:

```json
{
  "expo": {
    "extra": {
      "privyAppId": "your-privy-app-id",
      "privyClientId": "your-privy-client-id"
    }
  }
}
```

## How it works today

1. **Login:** email login through Privy, which creates an embedded wallet.
2. **Tracking:** `LocationService` samples GPS and motion sensors every second. Each record is "signed" by `TEECryptoService` (in reality a SHA-256 hash, see the status table) and chained to the previous record's hash in memory.
3. **Checkpoints:** every 30 seconds `MerkleService` builds a SHA-256 Merkle tree over the records, and `BlockchainService` submits the root and summary stats (average/max/min speed, distance, record count) to `SpeedRegistry` on Hedera testnet.
4. **XP:** `XPRewards` awards 1 XP per mile for checkpoints with average speed at or under 75 mph. XP can be "redeemed" for mock gift-card codes.

## App structure

```
chainspeed/
├── app/                          # Expo Router screens
│   ├── index.tsx                 # Tracking screen
│   ├── rewards.tsx               # XP and mock gift-card redemption
│   └── profile.tsx               # On-chain checkpoint history
├── components/                   # UI components
├── services/
│   ├── TEECryptoService.ts       # Placeholder for Secure Enclave signing (not yet real)
│   ├── CryptoService.ts          # Software hashing and placeholder attestation
│   ├── LocationService.ts        # GPS and sensor tracking
│   ├── MerkleService.ts          # 30-second checkpoints
│   ├── BlockchainService.ts      # Hedera contract calls
│   ├── XPService.ts              # XP reads and redemption
│   ├── DataAggregationService.ts # City aggregation (stub)
│   └── SpeedTrackingService.ts   # Orchestrator
├── contracts/
│   ├── contracts/SpeedRegistry.sol
│   ├── contracts/XPRewards.sol
│   └── scripts/                  # Deployment scripts
└── docs/                         # Planning docs from the hackathon (see notes at the top of each)
```

## Development

### Contracts

```bash
cd contracts
bun install
bunx hardhat test                                                  # SpeedRegistry v2 tests (XPRewards is untested)
REGISTRAR_ADDRESS=0x... bun run deploy:hedera-testnet              # deploy SpeedRegistry v2
bun scripts/export-abi.ts                                          # regenerate the app's ABI after contract changes
```

Deployment reads `PRIVATE_KEY` from the environment.

### Signed checkpoints (v2)

Built, covered by tests, and verified end to end on a physical iPhone 14 against Hedera testnet. Design: [docs/identity-design.md](docs/identity-design.md). Triage: [docs/security-triage.md](docs/security-triage.md).

| Piece | Where | Tests |
| --- | --- | --- |
| SpeedRegistry v2: device keys, P-256 signature, sequence and freshness checks | `contracts/` | `bunx hardhat test` |
| Device registrar: App Attest verification, Privy identity, on-chain registration | `server/` (Bun + Hono) | `bun test` in `server/` |
| Secure Enclave key, Face ID session, App Attest | `modules/secure-enclave/` (Swift) | Physical device only |
| Checkpoint digest, signature encoding, serialized submission | `services/identity/` | `bun test services/identity` |

To run it end to end:

1. Deploy SpeedRegistry v2 with a dedicated registrar address (above).
2. Configure and start the registrar: `cp server/.env.example server/.env`, fill it in, then `cd server && bun run dev`. The phone must reach it over HTTPS, for example through a tunnel.
3. In the Privy dashboard, enable "Return user data in an identity token".
4. `cp .env.example .env.local` and set the registry address and registrar URL.
5. Build to a physical iPhone: `bunx expo run:ios --device`. Neither the Secure Enclave nor App Attest works in the simulator.

**Path with spaces:** React Native's codegen build step fails if the project path contains a space (for example `Dive Deep/`). Build from a path without spaces.

### Docs

The files in [`docs/`](docs/) are the original hackathon planning and progress notes. They describe intended designs, not the implementation. Each now carries a status note at the top.
