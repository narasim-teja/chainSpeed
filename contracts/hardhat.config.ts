import { HardhatUserConfig } from "hardhat/config";
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const config: HardhatUserConfig & { etherscan?: any } = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Hedera EVM Testnet
    hederaTestnet: {
      url: "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY.startsWith('0x') ? process.env.PRIVATE_KEY : '0x' + process.env.PRIVATE_KEY] : [],
    },
    // Hedera EVM Mainnet (for future production)
    hederaMainnet: {
      url: "https://mainnet.hashio.io/api", 
      chainId: 295,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY.startsWith('0x') ? process.env.PRIVATE_KEY : '0x' + process.env.PRIVATE_KEY] : [],
    },
    // Legacy Flow networks (for backwards compatibility)
    flowTestnet: {
      url: "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY.startsWith('0x') ? process.env.PRIVATE_KEY : '0x' + process.env.PRIVATE_KEY] : [],
    },
    // Local development
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    // Hedera block explorer
    apiKey: {
      hederaTestnet: "no-api-key-needed",
      hederaMainnet: "no-api-key-needed",
      flowTestnet: "no-api-key-needed", // Legacy compatibility
    },
    customChains: [
      {
        network: "hederaTestnet",
        chainId: 296,
        urls: {
          apiURL: "https://hashscan.io/testnet/api",
          browserURL: "https://hashscan.io/testnet"
        }
      },
      {
        network: "hederaMainnet", 
        chainId: 295,
        urls: {
          apiURL: "https://hashscan.io/mainnet/api",
          browserURL: "https://hashscan.io/mainnet"
        }
      },
      {
        network: "flowTestnet", // Legacy compatibility
        chainId: 296,
        urls: {
          apiURL: "https://hashscan.io/testnet/api",
          browserURL: "https://hashscan.io/testnet"
        }
      }
    ]
  },
};

module.exports = config;
