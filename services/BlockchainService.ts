import { createPublicClient, http } from 'viem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CheckpointData } from './MerkleService';
import { getCryptoService } from './CryptoService';
import * as Crypto from 'expo-crypto';
import { FLOW_TESTNET_CONFIG, CONTRACT_CONFIG, SPEED_REGISTRY_ABI } from '../constants/Blockchain';

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

class BlockchainServiceClass {
  private publicClient: any;
  private isConnected = false;

  constructor() {
    this.initializeClients();
  }

  private initializeClients() {
    // Initialize public client for reading data
    this.publicClient = createPublicClient({
      transport: http(FLOW_TESTNET_CONFIG.rpcUrl),
    });
  }

  async checkConnection(): Promise<boolean> {
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      this.isConnected = true;
      console.log('Connected to Flow EVM Testnet, block:', blockNumber);
      return true;
    } catch (error) {
      console.error('Failed to connect to Flow EVM:', error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Submit a checkpoint to the blockchain using Privy's embedded wallet
   */
  async submitCheckpoint(checkpoint: CheckpointData): Promise<string | null> {
    try {
      // For now, we'll store this locally and submit later when we have Privy integration
      // This will be the transaction hash when we actually submit to blockchain
      
      const cryptoService = getCryptoService();
      const deviceAttestation = await cryptoService.getDeviceAttestation();
      
      // Create device attestation hash
      const attestationHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(deviceAttestation)
      );

      // Create blockchain checkpoint format
      const blockchainCheckpoint: BlockchainCheckpoint = {
        merkleRoot: checkpoint.merkleRoot,
        startTime: Math.floor(checkpoint.startTime / 1000), // Convert to seconds
        endTime: Math.floor(checkpoint.endTime / 1000),
        avgSpeed: checkpoint.avgSpeed,
        maxSpeed: checkpoint.maxSpeed,
        minSpeed: checkpoint.minSpeed,
        distanceMeters: checkpoint.distanceMeters,
        recordCount: checkpoint.recordCount,
        deviceAddress: '0x0000000000000000000000000000000000000000', // Will be set by contract
        deviceAttestation: '0x' + attestationHash,
      };

      // Store checkpoint for later blockchain submission
      await this.storePendingCheckpoint(blockchainCheckpoint);

      console.log('Checkpoint prepared for blockchain submission:', {
        merkleRoot: checkpoint.merkleRoot.substring(0, 8) + '...',
        timespan: (checkpoint.endTime - checkpoint.startTime) / 1000 + 's',
        records: checkpoint.recordCount,
      });

      // Return a mock transaction hash for now
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

      const checkpoint = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'getCheckpointByRoot',
        args: [merkleRoot],
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

      const isValid = await this.publicClient.readContract({
        address: CONTRACT_CONFIG.address,
        abi: SPEED_REGISTRY_ABI,
        functionName: 'verifyMerkleProof',
        args: [merkleRoot, proof, leaf, indices],
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
      network: FLOW_TESTNET_CONFIG.name,
      chainId: FLOW_TESTNET_CONFIG.id,
      explorer: FLOW_TESTNET_CONFIG.blockExplorer,
      contract: CONTRACT_CONFIG.address,
      connected: this.isConnected,
    };
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
            network: FLOW_TESTNET_CONFIG.name,
            explorer: FLOW_TESTNET_CONFIG.blockExplorer,
            verificationUrl: `${FLOW_TESTNET_CONFIG.blockExplorer}/address/${CONTRACT_CONFIG.address}`,
          }
        };
      }

      return {
        isValid: true,
        checkpoint,
        blockchainVerification: {
          contractAddress: CONTRACT_CONFIG.address,
          network: FLOW_TESTNET_CONFIG.name,
          explorer: FLOW_TESTNET_CONFIG.blockExplorer,
          verificationUrl: `${FLOW_TESTNET_CONFIG.blockExplorer}/address/${CONTRACT_CONFIG.address}`,
        }
      };

    } catch (error) {
      console.error('Failed to generate proof document:', error);
      return {
        isValid: false,
        blockchainVerification: {
          contractAddress: CONTRACT_CONFIG.address,
          network: FLOW_TESTNET_CONFIG.name,
          explorer: FLOW_TESTNET_CONFIG.blockExplorer,
          verificationUrl: `${FLOW_TESTNET_CONFIG.blockExplorer}/address/${CONTRACT_CONFIG.address}`,
        }
      };
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