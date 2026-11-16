import { createPublicClient, createWalletClient, http, custom, defineChain, type Address, type Hex } from 'viem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InvalidCheckpointError, OutOfOrderCheckpointError, type LocalCheckpoint } from './identity/checkpointInput';
import { toLeafValues } from './identity/recordTree';
import type { MerkleProof } from './MerkleService';
import { CheckpointSubmitter, StaleCheckpointError, type CheckpointChain } from './identity/checkpointSubmitter';
import { hasDriveSession, signWithDeviceKey } from './identity/deviceRegistration';
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
  keyHash: string; // keccak256(qx, qy) of the enclave key that signed it
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
  private checkpointSubmitter: CheckpointSubmitter | null = null;
  private isConnected = false;
  private xpCache: Map<string, { data: any; timestamp: number; }> = new Map();
  private readonly CACHE_DURATION = 30000; // 30 seconds cache

  constructor() {
    this.initializeClients();
  }

  /**
   * Utility function to execute a blockchain read operation with retry logic and exponential backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a rate limit error (429 status)
        const isRateLimit = error.message?.includes('429') || 
                           error.message?.includes('Rate limit') || 
                           error.details?.message?.includes('Rate limit');
        
        if (!isRateLimit || attempt === maxRetries) {
          throw error;
        }
        
        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`⏳ Rate limited, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(cacheKey: string): boolean {
    const cached = this.xpCache.get(cacheKey);
    if (!cached) return false;
    
    const now = Date.now();
    return (now - cached.timestamp) < this.CACHE_DURATION;
  }

  /**
   * Get data from cache or execute operation and cache result
   */
  private async getCachedOrFetch<T>(cacheKey: string, operation: () => Promise<T>): Promise<T> {
    // Check cache first
    if (this.isCacheValid(cacheKey)) {
      console.log(`📦 Using cached data for ${cacheKey}`);
      return this.xpCache.get(cacheKey)!.data;
    }

    // Execute operation with retry logic
    const result = await this.executeWithRetry(operation);
    
    // Cache the result
    this.xpCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });
    
    return result;
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
   * Signs a checkpoint with the device's Secure Enclave key and submits it to
   * SpeedRegistry v2 (see docs/identity-design.md). Submissions are serialized
   * and signed at send time, chained to the device's on-chain position.
   *
   * Returns the transaction hash; 'pending-…' if it was queued for a retry
   * (no wallet, no drive session, or a transient failure); or null if it can
   * no longer be anchored (past the contract's 10-minute window).
   */
  async submitCheckpoint(checkpoint: LocalCheckpoint): Promise<string | null> {
    const local: LocalCheckpoint = {
      merkleRoot: checkpoint.merkleRoot,
      startTime: checkpoint.startTime,
      endTime: checkpoint.endTime,
      avgSpeed: checkpoint.avgSpeed,
      maxSpeed: checkpoint.maxSpeed,
      minSpeed: checkpoint.minSpeed,
      distanceMeters: checkpoint.distanceMeters,
      recordCount: checkpoint.recordCount,
    };

    const device = await this.getConnectedAddress();
    if (!device) {
      await this.storePendingCheckpoint(local);
      return 'pending-' + Date.now().toString();
    }
    if (!hasDriveSession()) {
      console.warn('No drive session: checkpoint queued unsigned until Face ID unlocks the signing key');
      await this.storePendingCheckpoint(local);
      return 'pending-' + Date.now().toString();
    }

    try {
      const txHash = await this.getCheckpointSubmitter().submit(device, local);
      await this.removePendingCheckpoint(local.merkleRoot);
      console.log('Signed checkpoint anchored:', { root: local.merkleRoot.substring(0, 10) + '...', txHash });
      return txHash;
    } catch (error) {
      if (
        error instanceof StaleCheckpointError ||
        error instanceof OutOfOrderCheckpointError ||
        error instanceof InvalidCheckpointError
      ) {
        await this.removePendingCheckpoint(local.merkleRoot);
        await this.storeUnanchoredCheckpoint(local, error.message);
        return null;
      }
      console.error('Checkpoint submission failed, queued for retry:', error);
      await this.storePendingCheckpoint(local);
      return 'pending-' + Date.now().toString();
    }
  }

  private async getConnectedAddress(): Promise<Address | null> {
    if (!this.walletClient) return null;
    const accounts = await this.walletClient.getAddresses().catch(() => []);
    return accounts && accounts.length > 0 ? (accounts[0] as Address) : null;
  }

  private getCheckpointSubmitter(): CheckpointSubmitter {
    if (!this.checkpointSubmitter) {
      const chain: CheckpointChain = {
        chainId: CURRENT_CHAIN_CONFIG.id,
        registry: CONTRACT_CONFIG.address,
        readPosition: async (device) => {
          const read = (functionName: 'lastSeq' | 'lastRoot' | 'lastEndTime') =>
            this.publicClient.readContract({
              address: CONTRACT_CONFIG.address,
              abi: SPEED_REGISTRY_ABI,
              functionName,
              args: [device],
            });
          const [seq, prevRoot, lastEndTime] = await Promise.all([read('lastSeq'), read('lastRoot'), read('lastEndTime')]);
          return { seq: BigInt(seq), prevRoot: prevRoot as Hex, lastEndTime: BigInt(lastEndTime) };
        },
        sendCheckpoint: async (device, input, r, s) => {
          if (!this.walletClient) throw new Error('No wallet connected');
          const request = {
            address: CONTRACT_CONFIG.address,
            abi: SPEED_REGISTRY_ABI,
            functionName: 'submitCheckpoint',
            args: [device, input, r, s],
            account: device,
          } as const;
          // Hedera charges for at least 80% of the gas limit, so estimate instead of over-provisioning.
          // Estimation also surfaces the contract's revert reason before anything is sent.
          const estimate: bigint = await this.publicClient.estimateContractGas(request);
          const hash: Hex = await this.walletClient.writeContract({ ...request, gas: (estimate * 12n) / 10n });
          const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') throw new Error(`submitCheckpoint reverted: ${hash}`);
          return hash;
        },
      };
      this.checkpointSubmitter = new CheckpointSubmitter(chain, signWithDeviceKey);
    }
    return this.checkpointSubmitter;
  }

  // Pending = not yet anchored but still inside the contract's submission window.
  // v1 pending entries (unsigned structs) are not compatible and are dropped.
  private static readonly PENDING_KEY = 'pending_checkpoints_v2';
  private static readonly UNANCHORED_KEY = 'unanchored_checkpoints_v2';

  private async storePendingCheckpoint(checkpoint: LocalCheckpoint): Promise<void> {
    try {
      const pending = (await this.getPendingCheckpoints()).filter((cp) => cp.merkleRoot !== checkpoint.merkleRoot);
      pending.push(checkpoint);
      await AsyncStorage.setItem(BlockchainServiceClass.PENDING_KEY, JSON.stringify(pending.slice(-50)));
    } catch (error) {
      console.error('Failed to store pending checkpoint:', error);
    }
  }

  async getPendingCheckpoints(): Promise<LocalCheckpoint[]> {
    try {
      const data = await AsyncStorage.getItem(BlockchainServiceClass.PENDING_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to get pending checkpoints:', error);
      return [];
    }
  }

  /** Checkpoints that missed the submission window. Still on the device; never on chain. */
  async getUnanchoredCheckpoints(): Promise<(LocalCheckpoint & { reason: string })[]> {
    try {
      const data = await AsyncStorage.getItem(BlockchainServiceClass.UNANCHORED_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private async storeUnanchoredCheckpoint(checkpoint: LocalCheckpoint, reason: string): Promise<void> {
    const existing = await this.getUnanchoredCheckpoints();
    existing.push({ ...checkpoint, reason });
    await AsyncStorage.setItem(BlockchainServiceClass.UNANCHORED_KEY, JSON.stringify(existing.slice(-200)));
  }

  async clearAllPendingCheckpoints(): Promise<void> {
    await AsyncStorage.multiRemove([BlockchainServiceClass.PENDING_KEY, 'pending_checkpoints']);
    console.log('✅ All pending checkpoints cleared');
  }

  async clearPendingCheckpoints(): Promise<void> {
    await this.clearAllPendingCheckpoints();
  }

  private async removePendingCheckpoint(merkleRoot: string): Promise<void> {
    try {
      const pending = await this.getPendingCheckpoints();
      await AsyncStorage.setItem(
        BlockchainServiceClass.PENDING_KEY,
        JSON.stringify(pending.filter((cp) => cp.merkleRoot !== merkleRoot))
      );
    } catch (error) {
      console.error('Failed to remove pending checkpoint:', error);
    }
  }

  /**
   * Retries queued checkpoints in time order. Ones past the 10-minute window
   * cannot be anchored any more and move to the unanchored list.
   */
  async retryPendingCheckpoints(): Promise<{ submitted: number; failed: number }> {
    let submitted = 0;
    let failed = 0;
    const pending = (await this.getPendingCheckpoints()).sort((a, b) => a.startTime - b.startTime);
    for (const checkpoint of pending) {
      const result = await this.submitCheckpoint(checkpoint);
      if (result && result.startsWith('0x')) submitted++;
      else failed++;
    }
    console.log(`Retry completed: ${submitted} submitted, ${failed} not submitted`);
    return { submitted, failed };
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
        keyHash: cp.keyHash,
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

      // Lookups are per device (F5): a root only means something together with who anchored it.
      const device = await this.getConnectedAddress();
      if (!device) return null;
      const checkpoint = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'getCheckpointByRoot',
        args: [device, formattedMerkleRoot],
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
        keyHash: checkpoint.keyHash,
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
            keyHash: cp.keyHash
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
   * Verifies on chain that a record belongs to a checkpoint this device anchored
   * (SpeedRegistry.verifyRecord): Merkle inclusion plus the record's time inside the window.
   */
  async verifyRecordOnChain(proof: MerkleProof): Promise<boolean> {
    try {
      const device = await this.getConnectedAddress();
      if (!device) return false;
      return await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'verifyRecord',
        args: [device, proof.root, proof.path, toLeafValues(proof.record)],
      });
    } catch (error) {
      console.error('Failed to verify record on chain:', error);
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
    const cacheKey = `getUserXP_${userAddress}`;
    
    return await this.getCachedOrFetch(cacheKey, async () => {
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
    });
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
   * Get device statistics from blockchain
   */
  async getDeviceStats(deviceAddress: string): Promise<{
    totalDistance: number; // in miles
    totalTime: number; // in seconds
    maxRecordedSpeed: number; // in mph
    checkpointCount: number;
  }> {
    const cacheKey = `getDeviceStats_${deviceAddress}`;
    
    try {
      if (!this.isConnected) {
        await this.checkConnection();
      }

      console.log('Fetching device stats from blockchain for:', deviceAddress);

      return await this.getCachedOrFetch(cacheKey, async () => {
        const stats = await this.publicClient.readContract({
          address: CONTRACT_CONFIG.address,
          abi: SPEED_REGISTRY_ABI,
          functionName: 'getDeviceStats',
          args: [deviceAddress as `0x${string}`],
        });

        // Convert blockchain response to our format
        const result = {
          totalDistance: Number(stats[0]) / 1609.34, // Convert meters to miles
          totalTime: Number(stats[1]),
          maxRecordedSpeed: Number(stats[2]),
          checkpointCount: Number(stats[3])
        };

        console.log('Blockchain device stats:', result);
        return result;
      });

    } catch (error) {
      // console.error('Failed to get device stats from blockchain:', error);
      return {
        totalDistance: 0,
        totalTime: 0,
        maxRecordedSpeed: 0,
        checkpointCount: 0
      };
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