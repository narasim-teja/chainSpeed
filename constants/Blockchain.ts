export const CURRENT_CHAIN_CONFIG = {
  id: 296, 
  name: 'Hedera Testnet', 
  displayName: 'Hedera EVM', 
  rpcUrl: 'https://testnet.hashio.io/api', 
  blockExplorer: 'https://hashscan.io/testnet', 
  nativeCurrency: {
    name: 'HBAR', 
    symbol: 'HBAR', 
    decimals: 18,
  },
};


// Legacy exports for backwards compatibility
export const HEDERA_TESTNET_CONFIG = CURRENT_CHAIN_CONFIG;


// Smart contract configuration.
// SpeedRegistry v2 (signed checkpoints) is set per environment; see .env.example.
export const CONTRACT_CONFIG = {
  address: (process.env.EXPO_PUBLIC_SPEED_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  xpRewardsAddress: (process.env.EXPO_PUBLIC_XP_REWARDS_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
};

// The device registrar (server/). Must be reachable from the phone.
export const IDENTITY_CONFIG = {
  registrarUrl: process.env.EXPO_PUBLIC_REGISTRAR_URL ?? '',
};

// Generated from the compiled contract by contracts/scripts/export-abi.ts.
export { SPEED_REGISTRY_ABI } from './SpeedRegistryAbi';

// Generated from the compiled contract by contracts/scripts/export-abi.ts.
export { XP_REWARDS_ABI } from './XPRewardsAbi';
