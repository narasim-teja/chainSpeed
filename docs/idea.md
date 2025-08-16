# **ChainSpeed Technical Architecture Document** 🏗️

## **System Overview**

### **Core Components**
1. **React Native Mobile App** - User interface and data collection
2. **TEE-Secured Processing** - Tamper-proof speed recording
3. **Merkle Tree Construction** - Efficient data structure for proofs
4. **Blockchain Storage** - Immutable record keeping
5. **The Graph Indexer** - Query and proof generation
6. **Embedded Wallet** - Gasless transactions via Dynamic

## **Phase 1: Mobile App & Data Collection**

### **Initial Setup Flow**
1. **User Onboarding**
   - Email/phone authentication via Dynamic SDK
   - Embedded wallet creation (no seed phrases)
   - Server-side wallet for gas sponsorship

2. **Permission Requirements**
   - Location Services: Always allow (background)
   - Motion & Fitness: For accelerometer data
   - Bluetooth: For peer witness network (future)
   - Notifications: For alerts and rewards

### **Speed Data Collection Architecture**

**Multi-Source Speed Calculation**
- **Primary**: GPS location changes over time
- **Secondary**: Accelerometer integration for velocity
- **Tertiary**: Gyroscope for turn detection
- **Validation**: Magnetometer for heading verification

**Sampling Strategy**
- **GPS**: Every 1 second when moving >5mph
- **Accelerometer**: 10Hz sampling rate
- **Data Fusion**: Kalman filter to combine sources
- **Battery Optimization**: Adaptive sampling based on speed changes

**Local Data Structure**
```
SpeedRecord {
  timestamp: Unix milliseconds
  gpsLat: Float (6 decimal precision)
  gpsLon: Float (6 decimal precision)  
  gpsSpeed: Float (mph)
  gpsAccuracy: Float (meters)
  accelerometerX: Float
  accelerometerY: Float
  accelerometerZ: Float
  heading: Float (degrees)
  altitude: Float (meters)
}
```

## **Phase 2: TEE Implementation**

### **Feasibility Analysis**

**iOS: Secure Enclave**
- **Available**: Yes, on all modern iPhones
- **Capabilities**: Key generation, signing, encryption
- **Limitations**: Can't run arbitrary code, only crypto ops
- **Solution**: Sign data immediately after collection

**Android: StrongBox/TEE**
- **Available**: Android 9+ devices (most phones)
- **Capabilities**: Hardware-backed keystore
- **Limitations**: Varies by manufacturer
- **Solution**: Fallback to software-based attestation

### **TEE-Secured Data Flow**

1. **Key Generation at Install**
   - Generate device-specific key pair in TEE
   - Public key registered on blockchain
   - Private key never leaves secure hardware

2. **Real-time Signing**
   - Each SpeedRecord signed immediately
   - Signature includes previous record hash (chain)
   - Timestamp from secure time source

3. **Attestation Chain**
   ```
   Record[n] = {
     data: SpeedRecord,
     signature: TEE_Sign(data + hash(Record[n-1])),
     deviceKey: PublicKey
   }
   ```

### **TEE Limitations Workaround**

Since we can't run the entire app in TEE, we use a **"Sign-at-Source"** approach:
- Data collection happens in normal app space
- Immediately passed to TEE for signing
- Any tampering after signing is detectable
- Chain of signatures prevents record insertion/deletion

## **Phase 3: Merkle Tree Construction**

### **30-Second Checkpoint System**

**Local Merkle Tree (Every 30 seconds)**
1. Collect 30 SpeedRecords (1 per second)
2. Each record becomes a leaf: `Hash(record + signature)`
3. Build binary Merkle tree
4. Root hash represents 30 seconds of driving

**Structure**
```
        Root (30-sec summary)
       /                    \
    Node1                  Node2
   /     \                /     \
  N3      N4            N5      N6
 / \     / \           / \     / \
L1 L2   L3 L4         L5 L6   L7 L8
[SpeedRecords 1-30 with TEE signatures]
```

### **Aggregation Levels**
- **Level 1**: Individual records (1 second)
- **Level 2**: 30-second Merkle roots
- **Level 3**: 5-minute super-roots (10 L2 roots)
- **Level 4**: Trip summary (all L3 roots)

## **Phase 4: Blockchain Storage**

### **Storage Strategy**

**What Goes On-Chain (Every 30 seconds)**
```
CheckpointData {
  merkleRoot: bytes32
  startTime: uint256
  endTime: uint256
  avgSpeed: uint8
  maxSpeed: uint8
  minSpeed: uint8
  distanceMeters: uint16
  deviceKeyHash: bytes32
}
```

**What Stays Off-Chain**
- Raw GPS coordinates (privacy)
- Full Merkle tree structure
- Individual speed records
- TEE signatures

### **Encryption Layer**

**Data Encryption Flow**
1. Generate session key per trip
2. Encrypt location data with AES-256
3. Store encrypted blob on IPFS/Arweave
4. Only store IPFS hash on-chain

**Selective Disclosure**
- User controls decryption keys
- Can reveal specific time windows
- Court order triggers key release
- Zero-knowledge proofs for speed compliance

## **Phase 5: Smart Contract Architecture**

### **Core Contracts**

**SpeedRegistry.sol**
- Register device public keys
- Store checkpoint hashes
- Validate Merkle proofs
- Emit events for indexing

**ProofVerifier.sol**
- Verify Merkle inclusion proofs
- Validate TEE signatures
- Check timestamp continuity
- Generate court documents

**RewardPool.sol**
- Calculate PYUSD rewards
- Track driving streaks
- Distribute daily pools
- Handle staking/unstaking

### **Gasless Transaction Architecture**

**Using Dynamic's Embedded Wallets**
1. User signs with embedded wallet
2. Dynamic relays to blockchain
3. Gas paid from ChainSpeed treasury
4. User never sees gas costs

**Alternative: ERC-4337 Account Abstraction**
- Deploy smart wallet for each user
- Paymaster contract sponsors gas
- Batch multiple operations
- Social recovery options

## **Phase 6: The Graph Protocol Integration**

### **Subgraph Schema**

```graphql
type Driver @entity {
  id: ID! # wallet address
  deviceKey: Bytes!
  totalMiles: BigInt!
  totalCheckpoints: Int!
  violations: [Violation!]!
  rewards: [Reward!]!
}

type Checkpoint @entity {
  id: ID! # txHash-logIndex
  driver: Driver!
  merkleRoot: Bytes!
  timestamp: BigInt!
  avgSpeed: Int!
  maxSpeed: Int!
  distance: Int!
}

type SpeedProof @entity {
  id: ID!
  checkpoint: Checkpoint!
  requestTime: BigInt!
  proofData: Bytes!
  verified: Boolean!
}
```

### **Query Examples**

**Get Speed at Specific Time**
- Find checkpoints covering time range
- Request Merkle proof from driver's app
- Verify proof against on-chain root
- Return verified speed data

**Generate Legal Document**
- Query all checkpoints for date
- Aggregate speed statistics
- Include verification hashes
- Format for court submission

## **Phase 7: Proof Generation System**

### **User Flow for Ticket Defense**

1. **Input Ticket Details**
   - Date, time, location
   - Claimed speed
   - Officer badge number

2. **Automatic Proof Generation**
   - Query Graph for relevant checkpoints
   - Retrieve local Merkle tree data
   - Generate inclusion proofs
   - Create TEE attestation certificate

3. **Legal Document Creation**
   - PDF with QR codes
   - Blockchain verification links
   - Technical explanation for judge
   - Sworn affidavit template

### **Verification Website**
- Judge scans QR code
- Shows blockchain data
- Verifies Merkle proof
- Confirms TEE signatures
- Simple "Valid/Invalid" result

## **Technical Challenges & Solutions**

### **Challenge 1: Battery Drain**
**Solution**: 
- Batch GPS readings
- Use significant location changes
- Adaptive sampling rates
- Background task optimization

### **Challenge 2: Network Connectivity**
**Solution**:
- Local storage for 24 hours
- Batch upload when connected
- Offline Merkle tree construction
- Retry mechanism for failed transactions

### **Challenge 3: TEE Availability**
**Solution**:
- Graceful degradation
- Software attestation fallback
- Multi-signature from app + server
- Reputation system for non-TEE devices

### **Challenge 4: Storage Costs**
**Solution**:
- Compress checkpoint data
- Use events instead of storage
- IPFS for detailed data
- Pruning old records (after 3 years)

### **Challenge 5: User Privacy**
**Solution**:
- Geohash instead of exact coords
- Client-side encryption
- Zero-knowledge proofs
- Selective disclosure

## **Development Timeline**

### **Week 1: Core Infrastructure**
- React Native setup with sensor integration
- Dynamic wallet integration
- Basic GPS tracking
- Local data storage

### **Week 2: Blockchain Integration**
- Smart contract deployment
- Merkle tree implementation
- The Graph subgraph
- Basic proof generation

### **Week 3: TEE & Security**
- iOS Secure Enclave integration
- Android Keystore implementation
- Signature verification
- Encryption layer

### **Week 4: Polish & Launch**
- Legal document generation
- Verification website
- TestFlight deployment
- Demo preparation

## **Performance Metrics**

### **Target Specifications**
- **Battery Impact**: <5% daily drain
- **Storage**: <100MB per month
- **Proof Generation**: <2 seconds
- **Verification**: <500ms
- **Gas Cost**: $0.01 per checkpoint
- **Accuracy**: ±2 mph variance

### **Scaling Considerations**
- **Layer 2**: Deploy on Polygon/Arbitrum
- **State Channels**: For frequent updates
- **Rollup**: Batch multiple users
- **Sharding**: Partition by geography

## **Security Considerations**

### **Attack Vectors & Mitigations**

**GPS Spoofing**
- Multiple sensor validation
- Sudden location jump detection
- Peer witness network
- Accelerometer correlation

**Time Manipulation**
- NTP time synchronization
- Blockchain timestamp validation
- Sequential record verification
- TEE secure time source

**Device Compromise**
- TEE hardware security
- Attestation certificates
- Behavioral analysis
- Reputation scoring

**Sybil Attacks**
- One device per account
- Phone number verification
- Stake requirement
- Social graph analysis

## **Conclusion**

This architecture provides a technically feasible path to building ChainSpeed with:
- **Tamper-proof recording** via TEE signatures
- **Efficient storage** via Merkle trees
- **Privacy preservation** via encryption
- **Easy verification** via The Graph
- **User-friendly** via gasless transactions

The key innovation is using TEE for signing (not processing), making it feasible on current mobile hardware while maintaining cryptographic security sufficient for legal proceedings.