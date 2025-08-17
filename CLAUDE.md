# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainSpeed is a React Native mobile app built with Expo that demonstrates Privy authentication and embedded Ethereum wallet integration. The app provides email-based login with automatic wallet creation and message signing capabilities.

## Development Commands

**Setup and Installation:**
```bash
yarn install          # Install dependencies (preferred)
# or: bun install     # Alternative package manager
# or: npm install     # Fallback option
```

**Development:**
```bash
yarn start            # Start development server with dev client
yarn start-expo-go    # Start with Expo Go app
yarn ios              # Run on iOS simulator/device
yarn android          # Run on Android simulator/device
```

**Code Quality:**
```bash
yarn lint             # Run ESLint
```

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
- `expo-sensors`: Accelerometer, gyroscope, and magnetometer access
- `react-native-crypto-js`: Cryptographic signing and hashing
- `expo-task-manager`: Background task execution

**Implementation Status (MVP):**
- ✅ GPS tracking with multi-sensor validation
- ✅ Software-based signing and attestation system
- ✅ Merkle tree construction for 30-second checkpoints
- ✅ TrackingScreen UI for speed monitoring
- 🔄 Hedera blockchain integration (complete)
- 🔄 Legal document generation (pending)

**Core Services:**
- `LocationService`: GPS tracking with background processing
- `CryptoService`: Software-based signing and device attestation
- `MerkleService`: 30-second checkpoint creation with proof generation
- `SpeedTrackingService`: Main orchestrator service