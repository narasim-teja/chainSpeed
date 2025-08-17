# Migration to Hedera EVM Testnet

This document outlines the migration from Flow EVM Testnet to Hedera EVM Testnet.

## What Changed

### Network Configuration
- **Chain ID**: 545 (Flow) → 296 (Hedera Testnet)
- **RPC URL**: `https://testnet.evm.nodes.onflow.org` → `https://testnet.hashio.io/api`
- **Explorer**: `https://evm-testnet.flowscan.io` → `https://hashscan.io/testnet`
- **Native Currency**: FLOW → HBAR

### Files Updated
- `constants/Blockchain.ts` - Network configuration
- `services/BlockchainService.ts` - Client initialization and network switching
- `app/_layout.tsx` - Privy configuration
- `components/ProfileScreen.tsx` - UI labels and network references
- `contracts/hardhat.config.ts` - Hardhat network configuration

## Deployment Steps

### 1. Environment Setup

Create/update your `.env` file in the `contracts` directory:

```bash
# Hedera EVM Testnet Configuration
PRIVATE_KEY=your-private-key-here
RPC_URL=https://testnet.hashio.io/api
```

### 2. Install Dependencies

```bash
cd contracts
npm install
```

### 3. Deploy to Hedera

```bash
# Deploy the SpeedRegistry contract to Hedera Testnet
npx hardhat run scripts/deploy-hedera.ts --network hederaTestnet

# Alternative: Use the legacy network name for compatibility
npx hardhat run scripts/deploy-hedera.ts --network flowTestnet
```

### 4. Update Contract Address

After deployment, update the contract address in `constants/Blockchain.ts`:

```typescript
export const CONTRACT_CONFIG = {
  address: 'YOUR_NEW_HEDERA_CONTRACT_ADDRESS' as const,
};
```

### 5. Get Testnet HBAR

1. Visit [Hedera Portal](https://portal.hedera.com/)
2. Create an account or sign in
3. Go to Testnet section
4. Fund your wallet with testnet HBAR

### 6. Test the Application

1. Start the React Native app
2. Connect your wallet
3. Verify network shows "Hedera Testnet" (Chain ID: 296)
4. Test speed tracking and proof generation

## Key Differences from Flow

### Gas and Fees
- Hedera uses HBAR for gas fees
- Generally lower transaction costs
- More predictable fee structure

### Block Explorer
- Use [HashScan](https://hashscan.io/testnet) instead of FlowScan
- Different transaction and contract viewing interface

### RPC Endpoints
- Using Hashio (official Hedera RPC service)
- Production apps should consider running own RPC relay

### Network Features
- EVM compatibility maintained
- Same smart contract functionality
- Better throughput and finality

## Troubleshooting

### Common Issues

1. **"Unsupported chainId 296"**
   - Ensure Privy configuration includes Hedera chain
   - Check `app/_layout.tsx` supportedChains configuration

2. **Contract not found**
   - Verify contract was deployed successfully
   - Update CONTRACT_CONFIG.address with new address

3. **Insufficient HBAR balance**
   - Get testnet HBAR from Hedera Portal
   - Each transaction requires small HBAR amount

4. **RPC connection issues**
   - Verify `https://testnet.hashio.io/api` is accessible
   - Check network configuration in hardhat.config.ts

### Verification Commands

```bash
# Test Hardhat connection
npx hardhat console --network hederaTestnet

# Verify contract deployment
npx hardhat verify --network hederaTestnet CONTRACT_ADDRESS

# Check account balance
npx hardhat run scripts/check-balance.ts --network hederaTestnet
```

## Benefits of Hedera

1. **Lower Costs**: Significantly cheaper transactions
2. **Faster Finality**: ~3-5 second transaction finality
3. **Enterprise Ready**: Built for enterprise use cases
4. **Carbon Negative**: Environmentally sustainable network
5. **Regulatory Clarity**: Clear compliance framework

## Support

- [Hedera Documentation](https://docs.hedera.com/)
- [Hedera Discord](https://hedera.com/discord)
- [HashScan Explorer](https://hashscan.io/testnet)
- [Hashio RPC](https://www.hashgraph.com/hashio/)