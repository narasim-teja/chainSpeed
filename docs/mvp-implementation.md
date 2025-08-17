# ChainSpeed MVP Implementation Plan (24 Hours)

## Architecture Adaptations for MVP

### 1. Authentication & Wallet System
- **Current**: Privy embedded wallets ✅ 
- **Adaptation**: Use Privy's gasless transaction capabilities
- **Hedera Integration**: Privy supports Hedera blockchain via custom RPC

### 2. Security Model (MVP Approach)
- **Software-based signing** with app-level attestation
- **Device fingerprinting** for tamper detection
- **Cryptographic chain** linking consecutive records
- **Future**: Upgrade to TEE when time permits

### 3. Blockchain Target
- **Hedera Blockchain** (EVM-compatible network)
- **Gas sponsorship** via Privy's embedded wallet infrastructure
- **Low fees** suitable for frequent checkpoints

## Technical Stack

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React Native  │───▶│  Privy Wallet    │───▶│ Hedera Blockchain│
│   GPS Tracking  │    │  Gasless Txns    │    │  Smart Contract │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Local Storage  │    │  Merkle Trees    │    │  Proof Verifier │
│  Encrypted Data │    │  30s Checkpoints │    │  Legal Docs     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## MVP Features (Priority Order)

### Phase 1: Core Data Collection (Hours 1-6)
1. **GPS Tracking Service**
   - Background location monitoring
   - 1-second interval sampling
   - Speed calculation from coordinates
   - Battery optimization

2. **Multi-Sensor Integration**
   - Accelerometer for validation
   - Gyroscope for turn detection
   - Magnetometer for heading

3. **Local Data Structure**
   ```typescript
   interface SpeedRecord {
     timestamp: number;        // Unix milliseconds
     latitude: number;         // 6 decimal precision
     longitude: number;        // 6 decimal precision
     speed: number;           // mph from GPS
     accuracy: number;        // GPS accuracy in meters
     accelerometer: {x: number, y: number, z: number};
     heading: number;         // degrees
     signature: string;       // Software attestation
   }
   ```

### Phase 2: Cryptographic Security (Hours 7-12)
1. **Software-based Signing**
   - Device-specific key generation
   - ECDSA signatures for each record
   - Chain linking (each record includes previous hash)
   - Tamper detection via signature verification

2. **Merkle Tree Construction**
   - 30-second checkpoint creation
   - Binary tree of speed records
   - Root hash as blockchain commitment
   - Local storage of full tree

### Phase 3: Blockchain Integration (Hours 13-18)
1. **Hedera Smart Contract**
   ```solidity
   contract SpeedRegistry {
     struct Checkpoint {
       bytes32 merkleRoot;
       uint256 timestamp;
       uint8 avgSpeed;
       uint8 maxSpeed;
       uint16 distanceMeters;
       address device;
     }
     
     mapping(address => Checkpoint[]) public checkpoints;
     
     function submitCheckpoint(Checkpoint memory checkpoint) external;
     function verifyProof(bytes32[] memory proof, bytes32 leaf) external view returns (bool);
   }
   ```

2. **Privy Hedera Integration**
- Custom RPC configuration for Hedera
   - Gasless transaction setup
   - Automatic checkpoint submission

### Phase 4: Proof Generation (Hours 19-24)
1. **Ticket Defense System**
   - Time/location input interface
   - Merkle proof generation
   - Blockchain verification
   - PDF export with QR codes

2. **Legal Document Creation**
   - Sworn affidavit template
   - Technical verification section
   - QR codes linking to blockchain proof
   - Simple verification website

## Implementation Priorities

### Must-Have (MVP Core)
- [ ] GPS tracking with 1s precision
- [ ] Software signing of speed records
- [ ] 30-second Merkle checkpoints
- [x] Hedera blockchain storage
- [ ] Basic proof generation

### Should-Have (If Time)
- [ ] Multi-sensor validation
- [ ] Battery optimization
- [ ] Offline data handling
- [ ] Verification website

### Nice-to-Have (Future)
- [ ] TEE integration
- [ ] The Graph indexing
- [ ] Advanced legal document formatting
- [ ] Peer witness network

## Key Files to Create/Modify

1. **Services**
   - `services/LocationService.ts` - GPS tracking
   - `services/CryptoService.ts` - Signing and verification
   - `services/MerkleService.ts` - Tree construction
   - `services/BlockchainService.ts` - Hedera integration

2. **Components**
   - `components/TrackingScreen.tsx` - Main driving interface
   - `components/ProofScreen.tsx` - Ticket defense interface
   - `components/SettingsScreen.tsx` - Configuration

3. **Smart Contracts**
   - `contracts/SpeedRegistry.sol` - Core contract
   - `contracts/ProofVerifier.sol` - Verification logic

## Security Considerations for MVP

### Software-based Attestation
1. **Device Fingerprinting**
   - Hardware identifiers
   - App signature verification
   - Installation timestamp

2. **Cryptographic Chain**
   - Each record signs previous record hash
   - Prevents insertion/deletion
   - Detects tampering attempts

3. **Multi-layer Validation**
   - GPS + accelerometer correlation
   - Speed consistency checks
   - Sudden change detection

### Upgrade Path to TEE
- Keep same data structure
- Replace software signing with Secure Enclave
- Maintain backward compatibility
- Add attestation certificates

## Success Metrics

- **Accuracy**: ±2 mph variance from actual speed
- **Performance**: <5% battery drain per hour
- **Reliability**: 99% checkpoint success rate
- **Legal**: Generate court-ready documents in <30 seconds

This MVP focuses on proving the core concept while maintaining upgrade paths to full TEE security and advanced features.