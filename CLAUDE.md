# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainSpeed is a React Native mobile app built with Expo that demonstrates Privy authentication and embedded Ethereum wallet integration. The app provides email-based login with automatic wallet creation and message signing capabilities.

## Development Commands

**Setup and Installation:**
```bash
bun install           # Install dependencies (bun is the only package manager; don't use yarn or npm)
```

**Development:**
```bash
bun run start         # Start development server with dev client
bun run start-expo-go # Start with Expo Go app
bun run ios           # Run on iOS simulator/device
bun run android       # Run on Android simulator/device
```

**Code Quality:**
```bash
bun run lint          # Run ESLint
bunx tsc --noEmit     # Typecheck the app (contracts/ and server/ have their own tsconfig)
bun test services/identity  # App-side signing tests
```

**Contracts** (in `contracts/`, also bun):
```bash
bun install
bunx hardhat test
bun scripts/export-abi.ts   # regenerate constants/SpeedRegistryAbi.ts after contract changes
```

**Device registrar** (in `server/`, Bun + Hono):
```bash
bun install
bun test
bun run dev
```

**Device identity (v2):** checkpoints are signed by a Secure Enclave key (`modules/secure-enclave`, Swift) registered via App Attest by the server. See `docs/identity-design.md`. The native module only works on a physical iPhone.

**Build Tools:**
- Uses Metro bundler with custom configuration for jose package
- TypeScript compilation with strict settings
- Babel transpilation for React Native compatibility

## Architecture

**Core Stack:**
- React Native with Expo framework
- TypeScript for type safety
- Privy SDK for authentication and embedded wallets
- Expo Router for file-based navigation
- Viem for Ethereum blockchain interactions

**Key Directories:**
- `app/`: Screen components using Expo Router file-based routing
- `components/`: Reusable UI components (LoginScreen, UserScreen)
- `hooks/`: Custom React hooks for theme and color management
- `constants/`: App-wide constants and theme definitions

**Architecture Patterns:**
- Provider pattern: PrivyProvider wraps entire app in `app/_layout.tsx`
- Component-based screens with embedded wallet functionality
- Hook-based state management for theme and authentication
- Automatic wallet provisioning for new users via Privy

**Authentication Flow:**
1. Email-based login through Privy
2. Automatic embedded wallet creation for new users
3. Wallet operations (signing) available in UserScreen component

**Configuration:**
- App credentials configured in `app.json` (Privy app ID)
- Metro bundler handles jose package resolution
- iOS-specific configuration in `ios/` directory
- Transport security and App Transport Security configured

**Key Dependencies:**
- `@privy-io/expo`: Core authentication and wallet functionality
- `react-native-passkeys`: Modern passkey authentication support
- `viem`: Ethereum blockchain interaction library
- `expo-router`: File-based routing system
- `expo-location`: GPS tracking and background location services
- `expo-sensors`: Accelerometer readings (logged only, not validated or committed)
- `@noble/ciphers`: Encryption at rest (`services/storage`)

**Status:** see README "Status at a glance" and `docs/security-triage.md` (the source of truth for what is
and isn't done). Background tracking (TaskManager) is not enabled; tracking runs while the app is active.

**Core Services:**
- `LocationService`: GPS recording (records encrypted at rest)
- `MerkleService`: 30-second checkpoints (device-bound, salted record trees) and record proofs
- `BlockchainService`: Hedera calls; in-order checkpoint queue; serialized wallet transactions
- `SpeedTrackingService`: Main orchestrator service
- `services/identity/*`: device registration, checkpoint digest/signing, submission queue, record tree
- `CryptoService`: legacy software hashing; not evidence, not used for checkpoints