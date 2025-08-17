# 🚗 ChainSpeed - Secure Drive-to-Earn with TEE Technology

> **Revolutionary mobile app that uses hardware-backed TEE security to track driving speed, rewards safe driving behavior, and generates court-admissible evidence for legal protection.**


## 🌟 Overview

ChainSpeed combines iOS Secure Enclave TEE technology with multi-chain blockchain infrastructure to create the world's first legally-admissible speed tracking system that rewards safe driving. Built during a hackathon, this app addresses three major markets: the $6B annual speeding ticket industry, the $200B insurance data market, and the growing drive-to-earn ecosystem.

### 🎯 Key Features

- **🔐 Hardware-Backed Security**: Real iOS Secure Enclave integration for tamper-proof speed records
- **⚖️ Legal Protection**: Generate court-admissible evidence against false speeding tickets
- **💰 Drive-to-Earn**: Earn XP for safe driving, redeem for real gift cards (Target, Netflix)
- **🔗 Multi-Chain**: Hedera for legal records, Zircuit for rewards
- **📱 Seamless UX**: Privy embedded wallets with gasless transactions
- **📊 Privacy-First**: Anonymous data aggregation for traffic insights

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React Native  │───▶│  Privy Wallet    │───▶│ Multi-Chain     │
│   + TEE Security│    │  Gasless Txns    │    │ Deployment      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  iOS Secure     │    │  Merkle Trees    │    │  Legal Proof    │
│  Enclave        │    │  30s Checkpoints │    │  Generation     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📋 Smart Contract Deployments

### Hedera Testnet
- **SpeedRegistry**: [`0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8`](https://hashscan.io/testnet/contract/0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8)
- **XPRewards**: [`0x7224Cf802c4e6bDE9e67C8Eec2673dB85B0B7816`](https://hashscan.io/testnet/contract/0x7224Cf802c4e6bDE9e67C8Eec2673dB85B0B7816)

### Zircuit Testnet
- **SpeedRegistry**: [`0xC1768e08130BA10305064DbA76C57E890B270b3F`](https://explorer.testnet.zircuit.com/address/0xC1768e08130BA10305064DbA76C57E890B270b3F)
- **XPRewards**: [`0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8`](https://explorer.testnet.zircuit.com/address/0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- iOS device with Face ID/Touch ID (for TEE features)
- Expo CLI or Expo Go app

### Installation

```bash
# Clone the repository
git clone https://github.com/narasim-teja/chainSpeed.git
cd chainSpeed

# Install dependencies
yarn install

# Start the development server
yarn start

# Run on iOS
yarn ios
```

### Environment Setup

Create your Privy account and update `app.json`:

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

## 💡 How It Works

### 1. **TEE Security Layer**
```typescript
// Real iOS Secure Enclave integration
const teeService = getTEECryptoService();
await teeService.initialize(); // Generate hardware keys
await teeService.authenticateSession(); // Face ID auth
const signature = await teeService.signSpeedData(speedRecord); // Hardware signing
```

### 2. **Speed Tracking**
- GPS + accelerometer data collected every second
- Each record signed by Secure Enclave with Face ID protection
- 30-second Merkle tree checkpoints for efficient verification

### 3. **Multi-Chain Deployment**
- **Hedera**: Stores legal speed checkpoints (low cost, enterprise security)
- **Zircuit**: Processes XP rewards (enhanced security for user assets)

### 4. **Drive-to-Earn Mechanics**
- **1 XP per safe mile** (under 75 mph speed limit)
- **Streak bonuses** for consecutive safe driving days
- **Real gift cards** (Target, Netflix) redeemable with XP

## 🔧 Key Technologies

### Mobile Stack
- **React Native + Expo**: Cross-platform mobile development
- **TypeScript**: Type-safe development
- **iOS Secure Enclave**: Hardware-backed cryptographic signing
- **Multi-sensor fusion**: GPS, accelerometer, gyroscope validation

### Blockchain Stack
- **Hedera**: Primary blockchain for legal records
- **Zircuit**: Secondary chain for rewards system
- **Privy**: Embedded wallets and gasless transactions
- **Viem**: Ethereum interactions

### Security Features
- **TEE Hardware Signing**: Tamper-proof speed record signatures
- **Merkle Trees**: Efficient cryptographic proofs
- **Chain Linking**: Sequential record validation
- **Anonymous Aggregation**: Privacy-preserving data insights

## 📱 App Structure

```
chainspeed/
├── app/                    # Expo Router screens
│   ├── index.tsx          # Main tracking screen
│   ├── rewards.tsx        # XP and gift card redemption
│   └── profile.tsx        # Legal proof generation
├── components/            # Reusable UI components
├── services/              # Core business logic
│   ├── TEECryptoService.ts      # Secure Enclave integration
│   ├── LocationService.ts       # GPS tracking
│   ├── MerkleService.ts         # Checkpoint creation
│   ├── BlockchainService.ts     # Multi-chain interactions
│   └── XPService.ts             # Drive-to-earn logic
├── contracts/             # Smart contracts
│   ├── SpeedRegistry.sol        # Speed checkpoint storage
│   └── XPRewards.sol           # Drive-to-earn system
└── constants/             # Configuration
```

## 🎮 Usage Guide

### Starting a Tracking Session
1. **Login**: Seamless authentication with Privy
2. **TEE Setup**: Initialize Secure Enclave with Face ID
3. **Start Tracking**: Begin secure speed recording
4. **Drive Safely**: Earn XP for staying under speed limits
5. **Generate Proofs**: Create legal evidence when needed

### Earning Rewards
- Drive under 75 mph to earn 1 XP per mile
- Maintain daily driving streaks for bonus XP
- Redeem XP for real gift cards:
  - Target $10 = 1,000 XP
  - Netflix $10 = 1,000 XP
  - Target $50 = 5,000 XP
  - Netflix $50 = 5,000 XP

### Legal Defense
1. Navigate to Profile → Generate Speed Proof
2. Select date/time range of alleged violation
3. Generate blockchain-verified proof document
4. Present QR code evidence in court

## 🔒 Security Model

### TEE Implementation
- **Hardware Key Generation**: Private keys created in iOS Secure Enclave
- **Biometric Protection**: Face ID/Touch ID required for signing
- **Tamper Detection**: Chain-linked signatures prevent data manipulation
- **Session Management**: 30-minute authenticated sessions

### Privacy Protection
- **Local Processing**: GPS data processed on-device
- **Anonymous Aggregation**: City-level statistics only
- **Selective Disclosure**: Users control data sharing
- **Encrypted Storage**: Sensitive data encrypted at rest

## 🌍 Market Impact

### Problems Solved
- **$6B Speeding Tickets**: Unfair violations with no defense mechanism
- **$200B Insurance Data**: Companies profit while drivers get nothing
- **Drive-to-Earn Gap**: No real-world utility in existing apps

### Revenue Model
- **User Rewards**: XP system funded by data insights
- **Insurance Partnerships**: Anonymous safe driving analytics
- **Traffic Data**: City planning and navigation services
- **Legal Services**: Premium proof generation features

## 🛠️ Development

### Building for Production

```bash
# Build for iOS
yarn ios --configuration Release

# Build for Android
yarn android --variant=release

# Deploy smart contracts
cd contracts
npx hardhat deploy --network hedera-testnet
npx hardhat deploy --network zircuit-testnet
```

### Testing

```bash
# Run tests
yarn test

# Test TEE functionality (requires physical iOS device)
yarn test:tee

# Test blockchain integration
yarn test:contracts
```



