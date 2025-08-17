// Hedera EVM Testnet configuration
export const HEDERA_TESTNET_CONFIG = {
  id: 296,
  name: 'Hedera Testnet',
  rpcUrl: 'https://testnet.hashio.io/api',
  blockExplorer: 'https://hashscan.io/testnet',
  nativeCurrency: {
    name: 'HBAR',
    symbol: 'HBAR',
    decimals: 18,
  },
};

// Legacy export for backwards compatibility
export const FLOW_TESTNET_CONFIG = HEDERA_TESTNET_CONFIG;

// Smart contract configuration  
export const CONTRACT_CONFIG = {
  address: '0xBB8647F3eCa9fb1f2eb049B07697Ad02f8720ac8' as const, // Hedera EVM Testnet
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