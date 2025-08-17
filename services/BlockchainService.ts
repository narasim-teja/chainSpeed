import { createPublicClient, createWalletClient, http, custom, defineChain } from 'viem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CheckpointData } from './MerkleService';
import { getCryptoService } from './CryptoService';
import * as Crypto from 'expo-crypto';
import { CURRENT_CHAIN_CONFIG, CONTRACT_CONFIG, SPEED_REGISTRY_ABI, XP_REWARDS_ABI } from '../constants/Blockchain';

export interface BlockchainCheckpoint {
  merkleRoot: string;
  startTime: number;
  endTime: number;
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  distanceMeters: number;
  recordCount: number;
  deviceAddress: string;
  deviceAttestation: string;
}

// Define current chain for viem
const currentChain = defineChain({
  id: CURRENT_CHAIN_CONFIG.id,
  name: CURRENT_CHAIN_CONFIG.name,
  nativeCurrency: CURRENT_CHAIN_CONFIG.nativeCurrency,
  rpcUrls: {
    default: { http: [CURRENT_CHAIN_CONFIG.rpcUrl] },
  },
  blockExplorers: {
    default: { name: `${CURRENT_CHAIN_CONFIG.displayName} Explorer`, url: CURRENT_CHAIN_CONFIG.blockExplorer },
  },
});

class BlockchainServiceClass {
  private publicClient: any;
  private walletClient: any = null;
  private isConnected = false;

  constructor() {
    this.initializeClients();
  }

  /**
   * Format a hash string to proper bytes32 format for blockchain operations
   */
  private formatBytes32(hash: string, errorContext: string = 'hash', throwOnError: boolean = true): string | null {
    try {
      let formatted = hash;
      
      // Remove 0x prefix if present
      if (formatted.startsWith('0x')) {
        formatted = formatted.slice(2);
      }
      
      // SHA256 should be exactly 64 hex characters (32 bytes)
      if (formatted.length !== 64) {
        console.error(`Invalid ${errorContext} length:`, formatted.length, 'expected 64');
        if (throwOnError) {
          throw new Error(`Invalid ${errorContext} format: ${formatted}`);
        }
        return null;
      }
      
      return '0x' + formatted;
    } catch (error) {
      console.error(`Error formatting ${errorContext}:`, error);
      if (throwOnError) {
        throw error;
      }
      return null;
    }
  }

  private initializeClients() {
    // Initialize public client for reading data
    this.publicClient = createPublicClient({
      chain: currentChain,
      transport: http(CURRENT_CHAIN_CONFIG.rpcUrl),
    });
  }

  /**
   * Initialize wallet client with Privy provider
   */
  public async setWalletProvider(provider: any) {
    if (provider) {
      // Get the account address from the provider
      try {
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          const account = accounts[0];
          
          this.walletClient = createWalletClient({
            account: account,
            chain: currentChain,
            transport: custom(provider),
          });
          
          console.log('Wallet client initialized with account:', account);
        } else {
          throw new Error('No accounts found in provider');
        }
      } catch (error) {
        console.error('Failed to get account from provider:', error);
        
        // Fallback: create wallet client without account (will fail on writes)
        this.walletClient = createWalletClient({
          chain: currentChain,
          transport: custom(provider),
        });
        console.warn('Wallet client created without account - write operations may fail');
      }
      
      // Try to switch to current chain if not already on it
      await this.switchToCurrentChain(provider);
    }
  }

  /**
   * Switch wallet to current chain using Privy's method
   */
  private async switchToCurrentChain(provider: any): Promise<boolean> {
    try {
      // Check current chain
      const currentChainId = await provider.request({ method: 'eth_chainId' });
      const currentChainIdDecimal = parseInt(currentChainId, 16);
      
      console.log('Current wallet chain ID:', currentChainIdDecimal);
      
      if (currentChainIdDecimal === CURRENT_CHAIN_CONFIG.id) {
        console.log(`Wallet already on ${CURRENT_CHAIN_CONFIG.displayName}`);
        return true;
      }
      
      console.log(`Switching wallet to ${CURRENT_CHAIN_CONFIG.displayName} using provider method...`);
      
      // Use Privy's official method for React Native
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${CURRENT_CHAIN_CONFIG.id.toString(16)}` }],
      });
      
      console.log(`Successfully switched to ${CURRENT_CHAIN_CONFIG.displayName}`);
      return true;
      
    } catch (error: any) {
              console.error(`Error switching to ${CURRENT_CHAIN_CONFIG.displayName}:`, error);
      
      // If the chain doesn't exist, try to add it first
      if (error.code === 4902 || error.message?.includes('Unsupported chainId')) {
        console.log(`${CURRENT_CHAIN_CONFIG.displayName} not recognized, attempting to add it...`);
        
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${CURRENT_CHAIN_CONFIG.id.toString(16)}`,
              chainName: CURRENT_CHAIN_CONFIG.name,
              nativeCurrency: CURRENT_CHAIN_CONFIG.nativeCurrency,
              rpcUrls: [CURRENT_CHAIN_CONFIG.rpcUrl],
              blockExplorerUrls: [CURRENT_CHAIN_CONFIG.blockExplorer],
            }]
          });
          
          console.log('Hedera EVM testnet added successfully, now switching...');
          
          // Try switching again after adding
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${CURRENT_CHAIN_CONFIG.id.toString(16)}` }],
          });
          
          console.log('Successfully switched to Hedera EVM testnet after adding');
          return true;
          
        } catch (addError) {
          console.error('Failed to add Hedera EVM testnet:', addError);
          console.log('Please ensure Hedera EVM testnet is configured in your Privy supportedChains.');
        }
      }
      
      return false;
    }
  }

  /**
   * Alternative method: Switch using wallet.switchChain if available
   */
  public async switchNetworkUsingWallet(wallet: any): Promise<boolean> {
    try {
      if (wallet && wallet.switchChain) {
        console.log('Using wallet.switchChain method...');
        await wallet.switchChain(CURRENT_CHAIN_CONFIG.id); // 545
        console.log('Successfully switched using wallet.switchChain');
        return true;
      } else {
        console.log('wallet.switchChain not available, trying provider method...');
        
        // Fallback to provider method if available
        if (wallet && wallet.getProvider) {
          const provider = await wallet.getProvider();
          return true;
        }
        
        console.log('No switching method available');
        return false;
      }
    } catch (error: any) {
      console.error('Failed to switch using wallet.switchChain:', error);
      
      // If wallet.switchChain fails, try the provider method
      if (wallet && wallet.getProvider) {
        console.log('Trying fallback provider method after wallet.switchChain failed...');
        try {
          const provider = await wallet.getProvider();
          return true;
        } catch (providerError) {
          console.error('Provider method also failed:', providerError);
        }
      }
      
      return false;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      this.isConnected = true;
              console.log(`Connected to ${CURRENT_CHAIN_CONFIG.displayName}, block:`, blockNumber);
      return true;
    } catch (error) {
      console.error(`Failed to connect to ${CURRENT_CHAIN_CONFIG.displayName}:`, error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Submit a checkpoint to the blockchain using Privy's embedded wallet
   */
  async submitCheckpoint(checkpoint: CheckpointData): Promise<string | null> {
    try {
      const cryptoService = getCryptoService();
      const deviceAttestation = await cryptoService.getDeviceAttestation();
      
      // Create device attestation hash
      const attestationHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(deviceAttestation)
      );

      // Create blockchain checkpoint format
      const formattedMerkleRoot = this.formatBytes32(checkpoint.merkleRoot, 'Merkle root');
      const formattedAttestation = this.formatBytes32(attestationHash, 'attestation hash');
      
      if (!formattedMerkleRoot || !formattedAttestation) {
        throw new Error('Failed to format checkpoint data for blockchain submission');
      }
      
      console.log('Formatting checkpoint for blockchain:', {
        originalMerkleRoot: checkpoint.merkleRoot,
        formattedMerkleRoot,
        merkleRootLength: formattedMerkleRoot.length,
        originalAttestation: attestationHash,
        formattedAttestation,
        attestationLength: formattedAttestation.length,
        startTime: checkpoint.startTime,
        endTime: checkpoint.endTime,
        timeDifference: checkpoint.endTime - checkpoint.startTime,
        startTimeInSeconds: Math.floor(checkpoint.startTime / 1000),
        endTimeInSeconds: Math.floor(checkpoint.endTime / 1000),
        timeDifferenceInSeconds: Math.floor(checkpoint.endTime / 1000) - Math.floor(checkpoint.startTime / 1000),
      });
      
      // Convert timestamps to seconds and ensure endTime > startTime (contract requirement)
      const startTimeInSeconds = Math.floor(checkpoint.startTime / 1000);
      const endTimeInSeconds = Math.floor(checkpoint.endTime / 1000);
      
      // Ensure endTime is greater than startTime (smart contract validation)
      const finalEndTime = endTimeInSeconds <= startTimeInSeconds ? startTimeInSeconds + 1 : endTimeInSeconds;
      
      if (finalEndTime !== endTimeInSeconds) {
        console.log('Adjusted endTime to satisfy contract requirement:', {
          originalEndTime: endTimeInSeconds,
          adjustedEndTime: finalEndTime,
          startTime: startTimeInSeconds
        });
      }
      
      const blockchainCheckpoint: BlockchainCheckpoint = {
        merkleRoot: formattedMerkleRoot,
        startTime: startTimeInSeconds,
        endTime: finalEndTime,
        avgSpeed: Math.min(255, Math.max(0, checkpoint.avgSpeed)), // Ensure uint8 range (0-255)
        maxSpeed: Math.min(255, Math.max(0, checkpoint.maxSpeed)), // Ensure uint8 range (0-255)
        minSpeed: Math.min(255, Math.max(0, checkpoint.minSpeed)), // Ensure uint8 range (0-255)
        distanceMeters: Math.min(65535, Math.max(0, checkpoint.distanceMeters)), // Ensure uint16 range (0-65535)
        recordCount: Math.min(65535, Math.max(0, checkpoint.recordCount)), // Ensure uint16 range (0-65535)
        deviceAddress: '0x0000000000000000000000000000000000000000', // Will be set by contract
        deviceAttestation: formattedAttestation,
      };

      // Try to submit to blockchain if wallet is available
      if (this.walletClient) {
        try {
          // Check if wallet has sufficient balance first
          const hasFunds = await this.hasSufficientBalance();
          if (!hasFunds) {
            const balance = await this.getWalletBalance();
            console.warn('⚠️ Insufficient HBAR balance for transaction');
            if (balance) {
              console.warn(`💰 Current balance: ${balance.balanceInHBAR} (need ~0.02 HBAR for fees)`);
            }
            console.warn('💡 Get testnet HBAR from: https://portal.hedera.com/faucet');
            throw new Error('Insufficient HBAR balance');
          }

          // Get the connected account
          const accounts = await this.walletClient.getAddresses();
          if (accounts && accounts.length > 0) {
            const account = accounts[0];
            
            // Submit transaction to blockchain with optimized gas settings
            const txHash = await this.walletClient.writeContract({
              address: CONTRACT_CONFIG.address,
              abi: SPEED_REGISTRY_ABI,
              functionName: 'submitCheckpoint',
              args: [blockchainCheckpoint],
              account,
              gas: 300000n, // Reasonable gas limit for checkpoint submission
              gasPrice: 1000000000n, // 1 gwei - conservative gas price for Hedera
            });

            console.log('Checkpoint submitted to blockchain:', {
              merkleRoot: checkpoint.merkleRoot.substring(0, 8) + '...',
              txHash: txHash.substring(0, 8) + '...',
              records: checkpoint.recordCount,
              timespan: (checkpoint.endTime - checkpoint.startTime) / 1000 + 's'
            });

            // Remove from pending checkpoints since it's submitted
            await this.removePendingCheckpoint(blockchainCheckpoint.merkleRoot);
            
            return txHash;
          }
        } catch (txError: any) {
          console.error('Transaction failed, storing as pending:', txError);
          
          // Check if it's a funding issue
          if (txError.message && txError.message.includes('Insufficient funds')) {
            console.warn('⚠️ Wallet has insufficient HBAR balance for transaction fees');
            
            // Try to get current balance for better error reporting
            try {
              const balance = await this.getWalletBalance();
              if (balance) {
                console.warn(`💰 Current wallet balance: ${balance.balanceInHBAR}`);
                console.warn('💡 You need testnet HBAR to submit checkpoints to blockchain');
                console.warn('💡 Visit https://portal.hedera.com/faucet to get testnet HBAR');
              }
            } catch (balanceError) {
              console.warn('Could not retrieve wallet balance');
            }
          }
          
          // Fall through to store as pending
        }
      }

      // Store checkpoint for later blockchain submission (wallet not available or tx failed)
      await this.storePendingCheckpoint(blockchainCheckpoint);

      console.log('Checkpoint stored as pending:', {
        merkleRoot: checkpoint.merkleRoot.substring(0, 8) + '...',
        timespan: (checkpoint.endTime - checkpoint.startTime) / 1000 + 's',
        records: checkpoint.recordCount,
        reason: this.walletClient ? 'Transaction failed' : 'No wallet connected'
      });

      // Return a pending transaction identifier
      return 'pending-' + Date.now().toString();

    } catch (error) {
      console.error('Failed to submit checkpoint:', error);
      return null;
    }
  }

  private async storePendingCheckpoint(checkpoint: BlockchainCheckpoint): Promise<void> {
    try {
      const existing = await AsyncStorage.getItem('pending_checkpoints');
      const pending: BlockchainCheckpoint[] = existing ? JSON.parse(existing) : [];
      
      pending.push(checkpoint);
      
      // Keep only last 50 pending checkpoints
      const trimmed = pending.slice(-50);
      
      await AsyncStorage.setItem('pending_checkpoints', JSON.stringify(trimmed));
    } catch (error) {
      console.error('Failed to store pending checkpoint:', error);
    }
  }

  async getPendingCheckpoints(): Promise<BlockchainCheckpoint[]> {
    try {
      const data = await AsyncStorage.getItem('pending_checkpoints');
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to get pending checkpoints:', error);
      return [];
    }
  }

  /**
   * Clear all pending checkpoints (for manual cleanup)
   */
  async clearAllPendingCheckpoints(): Promise<void> {
    try {
      await AsyncStorage.removeItem('pending_checkpoints');
      console.log('✅ All pending checkpoints cleared');
    } catch (error) {
      console.error('Failed to clear pending checkpoints:', error);
      throw error;
    }
  }

  private async removePendingCheckpoint(merkleRoot: string): Promise<void> {
    try {
      const existing = await AsyncStorage.getItem('pending_checkpoints');
      const pending: BlockchainCheckpoint[] = existing ? JSON.parse(existing) : [];
      
      const filtered = pending.filter(cp => cp.merkleRoot !== merkleRoot);
      await AsyncStorage.setItem('pending_checkpoints', JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to remove pending checkpoint:', error);
    }
  }

  /**
   * Clear all pending checkpoints (for debugging)
   */
  async clearPendingCheckpoints(): Promise<void> {
    try {
      await AsyncStorage.setItem('pending_checkpoints', JSON.stringify([]));
      console.log('All pending checkpoints cleared');
    } catch (error) {
      console.error('Failed to clear pending checkpoints:', error);
    }
  }

  /**
   * Retry submitting all pending checkpoints
   */
  async retryPendingCheckpoints(): Promise<{ submitted: number; failed: number }> {
    let submitted = 0;
    let failed = 0;

    try {
      if (!this.walletClient) {
        console.log('No wallet available for retrying pending checkpoints');
        return { submitted, failed };
      }

      const accounts = await this.walletClient.getAddresses();
      if (!accounts || accounts.length === 0) {
        console.log('No accounts available for retrying pending checkpoints');
        return { submitted, failed };
      }

      const account = accounts[0];
      const pendingCheckpoints = await this.getPendingCheckpoints();

      console.log(`Retrying ${pendingCheckpoints.length} pending checkpoints...`);

      for (const checkpoint of pendingCheckpoints) {
        try {
          // Debug the checkpoint format before submission
          console.log('About to submit checkpoint:', {
            merkleRoot: checkpoint.merkleRoot,
            merkleRootLength: checkpoint.merkleRoot.length,
            deviceAttestation: checkpoint.deviceAttestation,
            attestationLength: checkpoint.deviceAttestation.length,
            startTime: checkpoint.startTime,
            endTime: checkpoint.endTime,
          });

          const txHash = await this.walletClient.writeContract({
            address: CONTRACT_CONFIG.address,
            abi: SPEED_REGISTRY_ABI,
            functionName: 'submitCheckpoint',
            args: [checkpoint],
            account,
            gas: 300000n, // Reasonable gas limit for checkpoint submission
            gasPrice: 1000000000n, // 1 gwei - conservative gas price for Hedera
          });

          console.log('Retry: Checkpoint submitted to blockchain:', {
            merkleRoot: checkpoint.merkleRoot.substring(0, 10) + '...',
            txHash: txHash.substring(0, 10) + '...',
          });

          await this.removePendingCheckpoint(checkpoint.merkleRoot);
          submitted++;

        } catch (txError) {
          console.error('Retry: Failed to submit checkpoint:', txError);
          console.error('Failed checkpoint data:', checkpoint);
          failed++;
        }
      }

      console.log(`Retry completed: ${submitted} submitted, ${failed} failed`);
      return { submitted, failed };

    } catch (error) {
      console.error('Failed to retry pending checkpoints:', error);
      return { submitted, failed };
    }
  }

  /**
   * Read checkpoints from the blockchain for a specific device
   */
  async getDeviceCheckpoints(deviceAddress: string): Promise<BlockchainCheckpoint[]> {
    try {
      if (!this.isConnected) {
        await this.checkConnection();
      }

      const checkpoints = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'getDeviceCheckpoints',
        args: [deviceAddress],
      });

      return checkpoints.map((cp: any) => ({
        merkleRoot: cp.merkleRoot,
        startTime: Number(cp.startTime),
        endTime: Number(cp.endTime),
        avgSpeed: cp.avgSpeed,
        maxSpeed: cp.maxSpeed,
        minSpeed: cp.minSpeed,
        distanceMeters: cp.distanceMeters,
        recordCount: cp.recordCount,
        deviceAddress: cp.deviceAddress,
        deviceAttestation: cp.deviceAttestation,
      }));

    } catch (error) {
      console.error('Failed to get device checkpoints:', error);
      return [];
    }
  }

  /**
   * Get a specific checkpoint by its merkle root
   */
  async getCheckpointByRoot(merkleRoot: string): Promise<BlockchainCheckpoint | null> {
    try {
      if (!this.isConnected) {
        await this.checkConnection();
      }

      // Format merkle root for blockchain query (ensure proper bytes32 format)
      const formattedMerkleRoot = this.formatBytes32(merkleRoot, 'Merkle root query', false);
      if (!formattedMerkleRoot) {
        return null;
      }
      
      console.log('Querying blockchain with formatted Merkle root:', {
        original: merkleRoot,
        formatted: formattedMerkleRoot,
        length: formattedMerkleRoot.length
      });

      const checkpoint = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'getCheckpointByRoot',
        args: [formattedMerkleRoot],
      });

      return {
        merkleRoot: checkpoint.merkleRoot,
        startTime: Number(checkpoint.startTime),
        endTime: Number(checkpoint.endTime),
        avgSpeed: checkpoint.avgSpeed,
        maxSpeed: checkpoint.maxSpeed,
        minSpeed: checkpoint.minSpeed,
        distanceMeters: checkpoint.distanceMeters,
        recordCount: checkpoint.recordCount,
        deviceAddress: checkpoint.deviceAddress,
        deviceAttestation: checkpoint.deviceAttestation,
      };

    } catch (error) {
      console.error('Failed to get checkpoint by root:', error);
      return null;
    }
  }

  /**
   * Get device checkpoints within a time range
   */
  async getDeviceCheckpointsInRange(
    deviceAddress: string,
    startTime: number,
    endTime: number
  ): Promise<BlockchainCheckpoint[]> {
    try {
      if (!this.isConnected) {
        await this.checkConnection();
      }

      // Convert timestamps to BigInt for blockchain
      const startTimeBigInt = BigInt(Math.floor(startTime / 1000)); // Convert to seconds
      const endTimeBigInt = BigInt(Math.floor(endTime / 1000));

      console.log('Querying blockchain checkpoints:', {
        device: deviceAddress,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        startTimeBigInt: startTimeBigInt.toString(),
        endTimeBigInt: endTimeBigInt.toString()
      });

      const checkpoints = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'getDeviceCheckpointsInRange',
        args: [deviceAddress as `0x${string}`, startTimeBigInt, endTimeBigInt],
      });

      // Convert blockchain response to our format
      const result: BlockchainCheckpoint[] = [];
      if (Array.isArray(checkpoints)) {
        for (const cp of checkpoints) {
          result.push({
            merkleRoot: cp.merkleRoot,
            startTime: Number(cp.startTime) * 1000, // Convert back to milliseconds
            endTime: Number(cp.endTime) * 1000,
            avgSpeed: Number(cp.avgSpeed),
            maxSpeed: Number(cp.maxSpeed),
            minSpeed: Number(cp.minSpeed),
            distanceMeters: Number(cp.distanceMeters),
            recordCount: Number(cp.recordCount),
            deviceAddress: cp.deviceAddress,
            deviceAttestation: cp.deviceAttestation
          });
        }
      }

      console.log(`Found ${result.length} blockchain checkpoints for device ${deviceAddress}`);
      return result;

    } catch (error) {
      console.error('Failed to get device checkpoints in range:', error);
      return [];
    }
  }

  /**
   * Verify a Merkle proof against a stored checkpoint
   */
  async verifyMerkleProof(
    merkleRoot: string,
    proof: string[],
    leaf: string,
    indices: number[]
  ): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.checkConnection();
      }

      // Format all elements for blockchain query
      const formattedMerkleRoot = this.formatBytes32(merkleRoot, 'Merkle root for proof', false);
      if (!formattedMerkleRoot) {
        return false;
      }

      const formattedProof: string[] = [];
      for (const p of proof) {
        const formatted = this.formatBytes32(p, 'proof element', false);
        if (!formatted) {
          return false;
        }
        formattedProof.push(formatted);
      }

      const formattedLeaf = this.formatBytes32(leaf, 'proof leaf', false);
      if (!formattedLeaf) {
        return false;
      }

      const isValid = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'verifyMerkleProof',
        args: [formattedMerkleRoot, formattedProof, formattedLeaf, indices],
      });

      return isValid;

    } catch (error) {
      console.error('Failed to verify Merkle proof:', error);
      return false;
    }
  }

  /**
   * Get blockchain network info
   */
  getNetworkInfo() {
    return {
      network: CURRENT_CHAIN_CONFIG.name,
      chainId: CURRENT_CHAIN_CONFIG.id,
      explorer: CURRENT_CHAIN_CONFIG.blockExplorer,
      contract: CONTRACT_CONFIG.address,
      connected: this.isConnected,
    };
  }

  /**
   * Get wallet balance in HBAR
   */
  async getWalletBalance(): Promise<{ balance: string; balanceInHBAR: string; balanceNumber: number } | null> {
    try {
      if (!this.walletClient) {
        return null;
      }

      const accounts = await this.walletClient.getAddresses();
      if (!accounts || accounts.length === 0) {
        return null;
      }

      const balance = await this.publicClient.getBalance({
        address: accounts[0],
      });

      // Convert from wei to HBAR (1 HBAR = 10^18 wei)
      const balanceNumber = Number(balance) / 1e18;
      const balanceInHBAR = balanceNumber.toFixed(6);

      return {
        balance: balance.toString(),
        balanceInHBAR: balanceInHBAR + ' HBAR',
        balanceNumber,
      };

    } catch (error) {
      console.error('Failed to get wallet balance:', error);
      return null;
    }
  }

  /**
   * Check if wallet has sufficient balance for transaction
   * Estimates ~0.01 HBAR needed for typical checkpoint submission
   */
  async hasSufficientBalance(): Promise<boolean> {
    try {
      const balance = await this.getWalletBalance();
      if (!balance) return false;
      
      // Require at least 0.02 HBAR for transaction fees (conservative estimate)
      const minimumBalance = 0.02;
      return balance.balanceNumber >= minimumBalance;
      
    } catch (error) {
      console.error('Failed to check balance:', error);
      return false;
    }
  }

  /**
   * Get total number of checkpoints on the blockchain
   */
  async getTotalCheckpoints(): Promise<number> {
    try {
      if (!this.isConnected) {
        await this.checkConnection();
      }

      const total = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'totalCheckpoints',
      });

      return Number(total);

    } catch (error) {
      console.error('Failed to get total checkpoints:', error);
      return 0;
    }
  }

  /**
   * Generate a blockchain proof document for legal use
   */
  async generateProofDocument(merkleRoot: string): Promise<{
    isValid: boolean;
    checkpoint?: BlockchainCheckpoint;
    blockchainVerification: {
      contractAddress: string;
      network: string;
      explorer: string;
      verificationUrl: string;
    };
  }> {
    try {
      const checkpoint = await this.getCheckpointByRoot(merkleRoot);
      
      if (!checkpoint) {
        return {
          isValid: false,
          blockchainVerification: {
            contractAddress: CONTRACT_CONFIG.address,
            network: CURRENT_CHAIN_CONFIG.name,
            explorer: CURRENT_CHAIN_CONFIG.blockExplorer,
            verificationUrl: `${CURRENT_CHAIN_CONFIG.blockExplorer}/address/${CONTRACT_CONFIG.address}`,
          }
        };
      }

      return {
        isValid: true,
        checkpoint,
        blockchainVerification: {
          contractAddress: CONTRACT_CONFIG.address,
          network: CURRENT_CHAIN_CONFIG.name,
          explorer: CURRENT_CHAIN_CONFIG.blockExplorer,
          verificationUrl: `${CURRENT_CHAIN_CONFIG.blockExplorer}/address/${CONTRACT_CONFIG.address}`,
        }
      };

    } catch (error) {
      console.error('Failed to generate proof document:', error);
      return {
        isValid: false,
        blockchainVerification: {
          contractAddress: CONTRACT_CONFIG.address,
          network: CURRENT_CHAIN_CONFIG.name,
          explorer: CURRENT_CHAIN_CONFIG.blockExplorer,
          verificationUrl: `${CURRENT_CHAIN_CONFIG.blockExplorer}/address/${CONTRACT_CONFIG.address}`,
        }
      };
    }
  }

  // ===== XP REWARDS CONTRACT METHODS =====

  /**
   * Toggle drive-to-earn feature for a user
   */
  async toggleDriveToEarn(enabled: boolean): Promise<boolean> {
    try {
      if (!this.walletClient) {
        throw new Error('Wallet not connected');
      }

      console.log(`🎯 Toggling drive-to-earn: ${enabled}`);

      // First, verify the contract exists by calling a read function
      try {
        const xpPerMile = await this.publicClient.readContract({
          address: CONTRACT_CONFIG.xpRewardsAddress,
          abi: XP_REWARDS_ABI,
          functionName: 'XP_PER_SAFE_MILE',
        });
        console.log('✅ Contract verified, XP per mile:', xpPerMile);
      } catch (contractError) {
        console.error('❌ Contract verification failed:', contractError);
        throw new Error(`XP Rewards contract not found at ${CONTRACT_CONFIG.xpRewardsAddress}`);
      }

      // Get account dynamically if not available
      let account = this.walletClient.account;
      if (!account) {
        const accounts = await this.walletClient.getAddresses();
        if (accounts && accounts.length > 0) {
          account = accounts[0];
        } else {
          throw new Error('No account available for transaction');
        }
      }

      const { request } = await this.publicClient.simulateContract({
        address: CONTRACT_CONFIG.xpRewardsAddress,
        abi: XP_REWARDS_ABI,
        functionName: 'toggleDriveToEarn',
        args: [enabled],
        account: account,
        gas: 150000n, // Increased gas limit
        gasPrice: 1000000000n, // 1 gwei
      });

      const hash = await this.walletClient.writeContract(request);
      console.log('🎯 Drive-to-earn toggle transaction:', hash);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log('✅ Drive-to-earn toggle confirmed:', receipt.status);

      return receipt.status === 'success';

    } catch (error) {
      console.error('Failed to toggle drive-to-earn:', error);
      throw error;
    }
  }

  /**
   * Process checkpoints for XP rewards
   */
  async processCheckpointsForXP(): Promise<boolean> {
    try {
      if (!this.walletClient) {
        throw new Error('Wallet not connected');
      }

      console.log('🎯 Processing checkpoints for XP...');

      // Get account dynamically if not available
      let account = this.walletClient.account;
      if (!account) {
        const accounts = await this.walletClient.getAddresses();
        if (accounts && accounts.length > 0) {
          account = accounts[0];
        } else {
          throw new Error('No account available for transaction');
        }
      }

      const { request } = await this.publicClient.simulateContract({
        address: CONTRACT_CONFIG.xpRewardsAddress,
        abi: XP_REWARDS_ABI,
        functionName: 'processCheckpointsForXP',
        account: account,
      });

      const hash = await this.walletClient.writeContract(request);
      console.log('🎯 XP processing transaction:', hash);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log('✅ XP processing confirmed:', receipt.status);

      return receipt.status === 'success';

    } catch (error) {
      console.error('Failed to process XP:', error);
      throw error;
    }
  }

  /**
   * Redeem XP for gift card
   */
  async redeemGiftCard(provider: string, value: number): Promise<boolean> {
    try {
      if (!this.walletClient) {
        throw new Error('Wallet not connected');
      }

      console.log(`🎁 Redeeming gift card: ${provider} $${value}`);

      // Get account dynamically if not available
      let account = this.walletClient.account;
      if (!account) {
        const accounts = await this.walletClient.getAddresses();
        if (accounts && accounts.length > 0) {
          account = accounts[0];
        } else {
          throw new Error('No account available for transaction');
        }
      }

      const { request } = await this.publicClient.simulateContract({
        address: CONTRACT_CONFIG.xpRewardsAddress,
        abi: XP_REWARDS_ABI,
        functionName: 'redeemGiftCard',
        args: [provider, value],
        account: account,
      });

      const hash = await this.walletClient.writeContract(request);
      console.log('🎁 Gift card redemption transaction:', hash);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log('✅ Gift card redemption confirmed:', receipt.status);

      return receipt.status === 'success';

    } catch (error) {
      console.error('Failed to redeem gift card:', error);
      throw error;
    }
  }

  /**
   * Get user's XP statistics
   */
  async getUserXP(userAddress: string): Promise<{
    totalXP: number;
    lifetimeMiles: number;
    safeMiles: number;
    currentStreak: number;
    driveToEarnEnabled: boolean;
  }> {
    try {
      const result = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.xpRewardsAddress,
        abi: XP_REWARDS_ABI,
        functionName: 'getUserXP',
        args: [userAddress],
      });

      return {
        totalXP: Number(result[0]),
        lifetimeMiles: Number(result[1]),
        safeMiles: Number(result[2]),
        currentStreak: Number(result[3]),
        driveToEarnEnabled: result[4],
      };

    } catch (error) {
      console.error('Failed to get user XP:', error);
      throw error;
    }
  }

  /**
   * Get user's redeemed gift cards
   */
  async getUserGiftCards(userAddress: string): Promise<Array<{
    provider: string;
    value: number;
    code: string;
    redeemed: boolean;
    redeemedAt: number;
  }>> {
    try {
      const result = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.xpRewardsAddress,
        abi: XP_REWARDS_ABI,
        functionName: 'getUserGiftCards',
        args: [userAddress],
      });

      return result.map((card: any) => ({
        provider: card.provider,
        value: Number(card.value),
        code: card.code,
        redeemed: card.redeemed,
        redeemedAt: Number(card.redeemedAt),
      }));

    } catch (error) {
      console.error('Failed to get user gift cards:', error);
      throw error;
    }
  }

  /**
   * Get available gift card options
   */
  async getGiftCardOptions(): Promise<{
    providers: string[];
    values: number[];
    costs: number[];
  }> {
    try {
      const result = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.xpRewardsAddress,
        abi: XP_REWARDS_ABI,
        functionName: 'getGiftCardOptions',
      });

      return {
        providers: result[0],
        values: result[1].map((v: any) => Number(v)),
        costs: result[2].map((c: any) => Number(c)),
      };

    } catch (error) {
      console.error('Failed to get gift card options:', error);
      throw error;
    }
  }

  /**
   * Get city statistics for data monetization
   */
  async getCityStats(city: string): Promise<{
    safeMiles: number;
    totalMiles: number;
    safetyPercentage: number;
  }> {
    try {
      const result = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.xpRewardsAddress,
        abi: XP_REWARDS_ABI,
        functionName: 'getCityStats',
        args: [city],
      });

      return {
        safeMiles: Number(result[0]),
        totalMiles: Number(result[1]),
        safetyPercentage: Number(result[2]),
      };

    } catch (error) {
      console.error('Failed to get city stats:', error);
      throw error;
    }
  }

  /**
   * Get XP contract constants
   */
  async getXPConstants(): Promise<{
    xpPerSafeMile: number;
    dailyStreakBonus: number;
    safeSpeedLimit: number;
  }> {
    try {
      const [xpPerMile, streakBonus, speedLimit] = await Promise.all([
        this.publicClient.readContract({
          address: CONTRACT_CONFIG.xpRewardsAddress,
          abi: XP_REWARDS_ABI,
          functionName: 'XP_PER_SAFE_MILE',
        }),
        this.publicClient.readContract({
          address: CONTRACT_CONFIG.xpRewardsAddress,
          abi: XP_REWARDS_ABI,
          functionName: 'DAILY_STREAK_BONUS',
        }),
        this.publicClient.readContract({
          address: CONTRACT_CONFIG.xpRewardsAddress,
          abi: XP_REWARDS_ABI,
          functionName: 'SAFE_SPEED_LIMIT',
        }),
      ]);

      return {
        xpPerSafeMile: Number(xpPerMile),
        dailyStreakBonus: Number(streakBonus),
        safeSpeedLimit: Number(speedLimit),
      };

    } catch (error) {
      console.error('Failed to get XP constants:', error);
      throw error;
    }
  }
}

// Singleton instance
let instance: BlockchainServiceClass | null = null;

export const getBlockchainService = (): BlockchainServiceClass => {
  if (!instance) {
    instance = new BlockchainServiceClass();
  }
  return instance;
};

export default BlockchainServiceClass;