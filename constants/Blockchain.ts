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


// Smart contract configuration  
export const CONTRACT_CONFIG = {
  address: '0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8' as const, // SpeedRegistry Contract
  xpRewardsAddress: '0x7224Cf802c4e6bDE9e67C8Eec2673dB85B0B7816' as const, // XP Rewards Contract
};

// Contract ABI for SpeedRegistry
export const SPEED_REGISTRY_ABI = [
  {
    "inputs": [
      {
        "components": [
          {"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
          {"internalType": "uint256", "name": "startTime", "type": "uint256"},
          {"internalType": "uint256", "name": "endTime", "type": "uint256"},
          {"internalType": "uint8", "name": "avgSpeed", "type": "uint8"},
          {"internalType": "uint8", "name": "maxSpeed", "type": "uint8"},
          {"internalType": "uint8", "name": "minSpeed", "type": "uint8"},
          {"internalType": "uint16", "name": "distanceMeters", "type": "uint16"},
          {"internalType": "uint16", "name": "recordCount", "type": "uint16"},
          {"internalType": "address", "name": "deviceAddress", "type": "address"},
          {"internalType": "bytes32", "name": "deviceAttestation", "type": "bytes32"}
        ],
        "internalType": "struct SpeedRegistry.Checkpoint",
        "name": "checkpoint",
        "type": "tuple"
      }
    ],
    "name": "submitCheckpoint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "device", "type": "address"}],
    "name": "getDeviceCheckpoints",
    "outputs": [
      {
        "components": [
          {"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
          {"internalType": "uint256", "name": "startTime", "type": "uint256"},
          {"internalType": "uint256", "name": "endTime", "type": "uint256"},
          {"internalType": "uint8", "name": "avgSpeed", "type": "uint8"},
          {"internalType": "uint8", "name": "maxSpeed", "type": "uint8"},
          {"internalType": "uint8", "name": "minSpeed", "type": "uint8"},
          {"internalType": "uint16", "name": "distanceMeters", "type": "uint16"},
          {"internalType": "uint16", "name": "recordCount", "type": "uint16"},
          {"internalType": "address", "name": "deviceAddress", "type": "address"},
          {"internalType": "bytes32", "name": "deviceAttestation", "type": "bytes32"}
        ],
        "internalType": "struct SpeedRegistry.Checkpoint[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"}],
    "name": "getCheckpointByRoot",
    "outputs": [
      {
        "components": [
          {"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
          {"internalType": "uint256", "name": "startTime", "type": "uint256"},
          {"internalType": "uint256", "name": "endTime", "type": "uint256"},
          {"internalType": "uint8", "name": "avgSpeed", "type": "uint8"},
          {"internalType": "uint8", "name": "maxSpeed", "type": "uint8"},
          {"internalType": "uint8", "name": "minSpeed", "type": "uint8"},
          {"internalType": "uint16", "name": "distanceMeters", "type": "uint16"},
          {"internalType": "uint16", "name": "recordCount", "type": "uint16"},
          {"internalType": "address", "name": "deviceAddress", "type": "address"},
          {"internalType": "bytes32", "name": "deviceAttestation", "type": "bytes32"}
        ],
        "internalType": "struct SpeedRegistry.Checkpoint",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
      {"internalType": "bytes32[]", "name": "proof", "type": "bytes32[]"},
      {"internalType": "bytes32", "name": "leaf", "type": "bytes32"},
      {"internalType": "uint256[]", "name": "indices", "type": "uint256[]"}
    ],
    "name": "verifyMerkleProof",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalCheckpoints",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "device", "type": "address"}],
    "name": "getDeviceCheckpointCount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "device", "type": "address"},
      {"indexed": true, "internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
      {"indexed": false, "internalType": "uint256", "name": "startTime", "type": "uint256"},
      {"indexed": false, "internalType": "uint256", "name": "endTime", "type": "uint256"},
      {"indexed": false, "internalType": "uint8", "name": "avgSpeed", "type": "uint8"},
      {"indexed": false, "internalType": "uint8", "name": "maxSpeed", "type": "uint8"}
    ],
    "name": "CheckpointSubmitted",
    "type": "event"
  }
] as const;

// Contract ABI for XPRewards
export const XP_REWARDS_ABI = [
  {
    "inputs": [{"internalType": "address", "name": "_speedRegistry", "type": "address"}],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [{"internalType": "bool", "name": "enabled", "type": "bool"}],
    "name": "toggleDriveToEarn",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "processCheckpointsForXP",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "string", "name": "provider", "type": "string"},
      {"internalType": "uint256", "name": "value", "type": "uint256"}
    ],
    "name": "redeemGiftCard",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
    "name": "getUserXP",
    "outputs": [
      {"internalType": "uint256", "name": "totalXP", "type": "uint256"},
      {"internalType": "uint256", "name": "lifetimeMiles", "type": "uint256"},
      {"internalType": "uint256", "name": "safeMiles", "type": "uint256"},
      {"internalType": "uint256", "name": "currentStreak", "type": "uint256"},
      {"internalType": "bool", "name": "driveToEarnEnabled", "type": "bool"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
    "name": "getUserGiftCards",
    "outputs": [
      {
        "components": [
          {"internalType": "string", "name": "provider", "type": "string"},
          {"internalType": "uint256", "name": "value", "type": "uint256"},
          {"internalType": "string", "name": "code", "type": "string"},
          {"internalType": "bool", "name": "redeemed", "type": "bool"},
          {"internalType": "uint256", "name": "redeemedAt", "type": "uint256"}
        ],
        "internalType": "struct XPRewards.GiftCard[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getGiftCardOptions",
    "outputs": [
      {"internalType": "string[]", "name": "providers", "type": "string[]"},
      {"internalType": "uint256[]", "name": "values", "type": "uint256[]"},
      {"internalType": "uint256[]", "name": "costs", "type": "uint256[]"}
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "string", "name": "provider", "type": "string"},
      {"internalType": "uint256", "name": "value", "type": "uint256"}
    ],
    "name": "getGiftCardCost",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "string", "name": "city", "type": "string"}],
    "name": "getCityStats",
    "outputs": [
      {"internalType": "uint256", "name": "safeMiles", "type": "uint256"},
      {"internalType": "uint256", "name": "totalMiles", "type": "uint256"},
      {"internalType": "uint256", "name": "safetyPercentage", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "XP_PER_SAFE_MILE",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DAILY_STREAK_BONUS",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SAFE_SPEED_LIMIT",
    "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "speedRegistry",
    "outputs": [{"internalType": "contract SpeedRegistry", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
      {"indexed": false, "internalType": "bool", "name": "enabled", "type": "bool"}
    ],
    "name": "DriveToEarnToggled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "xpAmount", "type": "uint256"},
      {"indexed": false, "internalType": "uint256", "name": "miles", "type": "uint256"},
      {"indexed": false, "internalType": "string", "name": "reason", "type": "string"}
    ],
    "name": "XPEarned",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
      {"indexed": false, "internalType": "string", "name": "provider", "type": "string"},
      {"indexed": false, "internalType": "uint256", "name": "value", "type": "uint256"},
      {"indexed": false, "internalType": "uint256", "name": "xpCost", "type": "uint256"}
    ],
    "name": "GiftCardRedeemed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "streakDays", "type": "uint256"},
      {"indexed": false, "internalType": "uint256", "name": "bonusXP", "type": "uint256"}
    ],
    "name": "StreakBonus",
    "type": "event"
  }
] as const;