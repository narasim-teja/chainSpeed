import { createPublicClient, createWalletClient, http, custom, defineChain, encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InvalidCheckpointError, OutOfOrderCheckpointError, type LocalCheckpoint } from './identity/checkpointInput';
import { toLeafValues } from './identity/recordTree';
import { PERMANENT_REVERTS, drainInOrder, revertName, type DrainResult, type SubmitOutcome } from './identity/checkpointQueue';
import { getSecureJSON, setSecureJSON } from './storage/secureStorage';
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
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
  private draining: Promise<unknown> = Promise.resolve();
  private walletLock: Promise<unknown> = Promise.resolve();
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
   * Queues a checkpoint and anchors the queue oldest first (see checkpointQueue.ts): each is
   * signed by the device's Secure Enclave key at send time and submitted to SpeedRegistry v2.
   *
   * Returns the transaction hash; 'pending-…' if it is still queued (no wallet, no drive
   * session, or an earlier checkpoint is waiting on a transient failure); or null if it can
   * never be anchored (stale, invalid, or rejected by the contract) and was set aside.
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
      device: checkpoint.device,
    };
    // Enqueue inside the drain lock: a drain already in flight writes back its own snapshot of
    // the queue, and would otherwise erase an entry added meanwhile.
    const result = await this.drainPendingQueue(local);
    const anchored = result.anchored.find((a) => a.checkpoint.merkleRoot === local.merkleRoot);
    if (anchored) return anchored.txHash;
    if (result.unanchored.some((u) => u.checkpoint.merkleRoot === local.merkleRoot)) return null;
    return 'pending-' + Date.now().toString();
  }

  /** Serialized: only one drain (and enqueue) runs at a time. */
  private drainPendingQueue(enqueue?: LocalCheckpoint): Promise<DrainResult<LocalCheckpoint>> {
    const run = this.draining.then(async () => {
      if (enqueue) await this.storePendingCheckpoint(enqueue);
      return this.drainPendingQueueNow();
    });
    this.draining = run.catch(() => undefined);
    return run;
  }

  private async drainPendingQueueNow(): Promise<DrainResult<LocalCheckpoint>> {
    const empty: DrainResult<LocalCheckpoint> = { anchored: [], unanchored: [], remaining: [] };
    const device = await this.getConnectedAddress();
    if (!device) return empty;
    if (!hasDriveSession()) {
      console.warn('No drive session: checkpoints stay queued until Face ID unlocks the signing key');
      return empty;
    }

    const queue = await this.getPendingCheckpoints();
    const result = await drainInOrder(queue, (cp) =>
      cp.device && cp.device.toLowerCase() !== device.toLowerCase()
        ? Promise.resolve<SubmitOutcome>({ kind: 'permanent', reason: 'Recorded for a different wallet' })
        : this.submitOne(device, cp)
    );

    for (const { checkpoint, txHash } of result.anchored) {
      console.log('Signed checkpoint anchored:', { root: checkpoint.merkleRoot.substring(0, 10) + '...', txHash });
    }
    for (const { checkpoint, reason } of result.unanchored) {
      await this.storeUnanchoredCheckpoint(checkpoint, reason);
    }
    await setSecureJSON(BlockchainServiceClass.PENDING_KEY, result.remaining);
    return result;
  }

  private async submitOne(device: Address, checkpoint: LocalCheckpoint): Promise<SubmitOutcome> {
    try {
      return { kind: 'anchored', txHash: await this.getCheckpointSubmitter().submit(device, checkpoint) };
    } catch (error) {
      const name = revertName(error);
      const tooLateOrDuplicate =
        error instanceof StaleCheckpointError || error instanceof OutOfOrderCheckpointError || name === 'DuplicateRoot';
      // A transaction can be mined even though its receipt was lost: check before giving up on it.
      if (tooLateOrDuplicate) {
        const anchored = await this.isAnchored(device, checkpoint.merkleRoot);
        if (anchored === true) return { kind: 'anchored', txHash: 'already-anchored' };
        if (anchored === 'unknown') return { kind: 'transient', reason: 'Could not check whether it was anchored' };
      }
      if (tooLateOrDuplicate || error instanceof InvalidCheckpointError) {
        return { kind: 'permanent', reason: error instanceof Error ? error.message : String(name) };
      }
      if (name && PERMANENT_REVERTS.has(name)) return { kind: 'permanent', reason: `Contract rejected it: ${name}` };
      console.error('Checkpoint submission failed; it stays queued, in order:', error);
      return { kind: 'transient', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /** true / false from the contract; 'unknown' if the chain could not be reached. */
  private async isAnchored(device: Address, merkleRoot: string): Promise<boolean | 'unknown'> {
    try {
      await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'getCheckpointByRoot',
        args: [device, merkleRoot],
      });
      return true;
    } catch (error) {
      return revertName(error) === 'CheckpointNotFound' ? false : 'unknown';
    }
  }

  /**
   * Sends one transaction from the user's wallet and waits for its receipt. Wallet writes are
   * serialized: two in flight at once (say, the last checkpoint and the XP call at Stop) can be
   * given the same nonce and one of them rejected.
   */
  private sendAndWait(request: any): Promise<{ hash: Hex; receipt: any }> {
    const run = this.walletLock.then(async () => {
      // A hung wallet request would otherwise hold the lock, the queue and Stop forever.
      const hash: Hex = await withTimeout(this.walletClient.writeContract(request), 120_000, 'Wallet request timed out');
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    });
    this.walletLock = run.catch(() => undefined);
    return run;
  }

  /** The connected wallet, which is also the device address checkpoints are signed for. */
  async getDeviceAddress(): Promise<Address | null> {
    return this.getConnectedAddress();
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
          const { hash, receipt } = await this.sendAndWait({ ...request, gas: (estimate * 12n) / 10n });
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
      const overflow = pending.slice(0, Math.max(0, pending.length - 50));
      for (const dropped of overflow) {
        await this.storeUnanchoredCheckpoint(dropped, 'Queue full: too many checkpoints waiting');
      }
      await setSecureJSON(BlockchainServiceClass.PENDING_KEY, pending.slice(-50));
    } catch (error) {
      console.error('Failed to store pending checkpoint:', error);
    }
  }

  async getPendingCheckpoints(): Promise<LocalCheckpoint[]> {
    try {
      return (await getSecureJSON<LocalCheckpoint[]>(BlockchainServiceClass.PENDING_KEY)) ?? [];
    } catch (error) {
      console.error('Failed to get pending checkpoints:', error);
      return [];
    }
  }

  /** Checkpoints that missed the submission window. Still on the device; never on chain. */
  async getUnanchoredCheckpoints(): Promise<(LocalCheckpoint & { reason: string })[]> {
    try {
      return (await getSecureJSON<(LocalCheckpoint & { reason: string })[]>(BlockchainServiceClass.UNANCHORED_KEY)) ?? [];
    } catch {
      return [];
    }
  }

  private async storeUnanchoredCheckpoint(checkpoint: LocalCheckpoint, reason: string): Promise<void> {
    const existing = await this.getUnanchoredCheckpoints();
    existing.push({ ...checkpoint, reason });
    await setSecureJSON(BlockchainServiceClass.UNANCHORED_KEY, existing.slice(-200));
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
      await setSecureJSON(
        BlockchainServiceClass.PENDING_KEY,
        pending.filter((cp) => cp.merkleRoot !== merkleRoot)
      );
    } catch (error) {
      console.error('Failed to remove pending checkpoint:', error);
    }
  }

  /**
   * Anchors queued checkpoints, oldest first. Ones that can never be anchored (past the
   * 10-minute window, invalid, or rejected by the contract) move to the unanchored list.
   */
  async retryPendingCheckpoints(): Promise<{ submitted: number; failed: number }> {
    const result = await this.drainPendingQueue();
    const submitted = result.anchored.length;
    const failed = result.unanchored.length + result.remaining.length;
    console.log(`Retry completed: ${submitted} anchored, ${result.unanchored.length} unanchored, ${result.remaining.length} still queued`);
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

  /** The device key registered on chain for `device`, as SpeedRegistry stores it. */
  async getDeviceKeyStatus(device: string): Promise<{ active: boolean; keyHash: Hex } | null> {
    try {
      const [qx, qy, active] = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'deviceKeys',
        args: [device],
      });
      return { active, keyHash: keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [qx, qy])) };
    } catch (error) {
      console.error('Failed to read device key status:', error);
      return null;
    }
  }

  /**
   * Verifies on chain that a record belongs to a checkpoint this device anchored
   * (SpeedRegistry.verifyRecord): Merkle inclusion plus the record's time inside the window.
   */
  async verifyRecordOnChain(proof: MerkleProof): Promise<boolean> {
    try {
      return await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'verifyRecord',
        args: [proof.device, proof.root, proof.path, toLeafValues(proof.record)],
      });
    } catch (error) {
      // Not the raw error: viem includes the call's arguments, which contain the record's coordinates.
      console.error('Failed to verify record on chain:', revertName(error) ?? (error as any)?.shortMessage ?? 'unknown error');
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

      const { hash, receipt } = await this.sendAndWait(request);
      console.log('🎯 Drive-to-earn toggle transaction:', hash);

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

      const { hash, receipt } = await this.sendAndWait(request);
      console.log('🎯 XP processing transaction:', hash);

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

      const { hash, receipt } = await this.sendAndWait(request);
      console.log('🎁 Gift card redemption transaction:', hash);

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