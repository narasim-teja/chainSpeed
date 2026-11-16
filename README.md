# ChainSpeed

> **Hackathon prototype (August 2025).** ChainSpeed set out to explore whether a phone could produce tamper-evident driving-speed records, anchor them on chain, and reward safe driving. It was an ambitious build for the time available, and **several security properties described in earlier versions of this README were never implemented.** The current state is described honestly below. Do not use this app as evidence or as a source of truth for anything.

## Status at a glance

An independent security review in November 2026 found that the trust model is not yet real. The table below separates what works from what is simulated or missing.

| Area | What works today | What is simulated or missing |
| --- | --- | --- |
| Speed tracking | GPS + motion sensors sampled every second; records batched into 30-second checkpoints | Timestamps come from the device clock and can be backdated |
| "Secure Enclave" signing | UI flow, Face ID prompt (once per 30-minute session) | **No Secure Enclave key is generated.** `TEECryptoService` stores a placeholder string in the Keychain and produces SHA-256 hashes of known values. The "public key" is identical on every install. These are not signatures. |
| Device attestation | — | No App Attest / DeviceCheck, no key registration, no binding between a device key and a user |
| On-chain checkpoints (Hedera testnet) | Merkle roots and summary stats are submitted to `SpeedRegistry` | Checkpoints are unsigned, caller-supplied data; any caller can overwrite the record for a given root |
| Merkle proofs | Trees are built on device | The app hashes with SHA-256 and the contract verifies with keccak256, so app-generated proofs cannot verify on chain |
| XP rewards | `XPRewards` contract computes XP from submitted checkpoints | XP inputs are unverified client data; "gift card" codes are mock strings with no fulfillment |
| Multi-chain | Contracts were also deployed to Zircuit testnet | The app only talks to Hedera; the Zircuit deployment is not reachable from the app |
| Gas | Privy embedded wallets | Not gasless: the user's wallet pays gas (testnet HBAR from the faucet) |
| Privacy | Raw data stays on device | Records are stored as plaintext JSON with precise GPS coordinates; city-level aggregation is a stub |
| Legal evidence | — | Not court-admissible. There is no trusted time, signer identity, attestation, or verifiable inclusion proof, and local records are deleted after 24 hours |

Fixes for the core issues are in progress.

## Original idea

Drivers often have no independent record of their own speed. ChainSpeed's goal was:

1. Record speed on the phone, signed by a hardware-protected key the user cannot extract.
2. Commit batches of records to a public chain so they cannot be quietly changed later.
3. Let the driver reveal a specific window (with a Merkle proof) when they need to, without exposing their whole history.
4. Reward safe driving with XP, and use anonymized city-level data to fund those rewards.

Steps 1 and 3 are the hard parts, and they are the ones that are not yet real. Getting them right needs a genuine Secure Enclave P-256 key, Apple App Attest, server-issued freshness nonces, key registration bound to the user, signed checkpoints verified on chain or by a server, and one consistent hashing scheme between client and contract.

## Smart contract deployments (testnets)

### Hedera Testnet (used by the app)

- **SpeedRegistry**: [`0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8`](https://hashscan.io/testnet/contract/0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8)
- **XPRewards**: [`0x7224Cf802c4e6bDE9e67C8Eec2673dB85B0B7816`](https://hashscan.io/testnet/contract/0x7224Cf802c4e6bDE9e67C8Eec2673dB85B0B7816)

### Zircuit Testnet (deployed, not wired into the app)

- **SpeedRegistry**: [`0xC1768e08130BA10305064DbA76C57E890B270b3F`](https://explorer.testnet.zircuit.com/address/0xC1768e08130BA10305064DbA76C57E890B270b3F)
- **XPRewards**: [`0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8`](https://explorer.testnet.zircuit.com/address/0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8)

These contracts match the security limitations described above.

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
bunx hardhat test                                                    # SpeedRegistry tests (XPRewards is untested)
bunx hardhat run scripts/deploy-hedera.ts --network hederaTestnet    # deploy to Hedera testnet
```

Deployment reads `PRIVATE_KEY` from the environment.

### Docs

The files in [`docs/`](docs/) are the original hackathon planning and progress notes. They describe intended designs, not the implementation. Each now carries a status note at the top.
