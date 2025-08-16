import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpeedRecord } from './LocationService';
import { getCryptoService, SignedData } from './CryptoService';
import { getBlockchainService } from './BlockchainService';

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
  data?: SpeedRecord;
}

export interface MerkleProof {
  leaf: string;
  path: string[];
  indices: number[];
  root: string;
}

export interface CheckpointData {
  merkleRoot: string;
  startTime: number;
  endTime: number;
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  distanceMeters: number;
  recordCount: number;
  deviceAttestation: any;
  signature: string;
}

const CHECKPOINT_STORAGE_KEY = 'merkle_checkpoints';
const CHECKPOINT_INTERVAL = 30000; // 30 seconds in milliseconds

class MerkleServiceClass {
  private pendingRecords: SpeedRecord[] = [];
  private lastCheckpointTime = 0;

  constructor() {
    this.startCheckpointTimer();
  }

  private startCheckpointTimer(): void {
    // Create checkpoint every 30 seconds if we have records
    setInterval(async () => {
      if (this.pendingRecords.length > 0) {
        await this.createCheckpoint();
      }
    }, CHECKPOINT_INTERVAL);
  }

  public addRecord(record: SpeedRecord): void {
    this.pendingRecords.push(record);
    
    // The timer will handle checkpoint creation automatically
  }

  private async createCheckpoint(): Promise<CheckpointData | null> {
    try {
      if (this.pendingRecords.length === 0) return null;

      // Build Merkle tree from pending records
      const merkleTree = await this.buildMerkleTree(this.pendingRecords);
      if (!merkleTree) return null;

      // Calculate checkpoint statistics
      const stats = this.calculateStats(this.pendingRecords);

      // Create checkpoint data
      const checkpointData: Omit<CheckpointData, 'signature'> = {
        merkleRoot: merkleTree.hash,
        startTime: this.pendingRecords[0].timestamp,
        endTime: this.pendingRecords[this.pendingRecords.length - 1].timestamp,
        avgSpeed: stats.avgSpeed,
        maxSpeed: stats.maxSpeed,
        minSpeed: stats.minSpeed,
        distanceMeters: stats.distance,
        recordCount: this.pendingRecords.length,
        deviceAttestation: await getCryptoService().getDeviceAttestation()
      };

      // Sign the checkpoint
      const signedCheckpoint = await getCryptoService().signData(checkpointData);
      const finalCheckpoint: CheckpointData = {
        ...checkpointData,
        signature: signedCheckpoint.signature
      };

      // Store checkpoint and tree
      await this.storeCheckpoint(finalCheckpoint, merkleTree, this.pendingRecords);

      // Submit checkpoint to blockchain
      try {
        const blockchainService = getBlockchainService();
        const txHash = await blockchainService.submitCheckpoint(finalCheckpoint);
        if (txHash) {
          console.log('Checkpoint submitted to blockchain:', {
            root: finalCheckpoint.merkleRoot.substring(0, 8) + '...',
            txHash: txHash.substring(0, 8) + '...',
            records: finalCheckpoint.recordCount,
            timespan: (finalCheckpoint.endTime - finalCheckpoint.startTime) / 1000 + 's'
          });
        }
      } catch (error) {
        console.error('Failed to submit checkpoint to blockchain:', error);
      }

      console.log('Checkpoint created:', {
        root: finalCheckpoint.merkleRoot,
        records: finalCheckpoint.recordCount,
        timespan: (finalCheckpoint.endTime - finalCheckpoint.startTime) / 1000 + 's'
      });

      // Clear pending records
      this.pendingRecords = [];
      this.lastCheckpointTime = Date.now();

      return finalCheckpoint;

    } catch (error) {
      console.error('Failed to create checkpoint:', error);
      return null;
    }
  }

  private async buildMerkleTree(records: SpeedRecord[]): Promise<MerkleNode | null> {
    if (records.length === 0) return null;

    // Create leaf nodes
    let currentLevel: MerkleNode[] = [];
    for (const record of records) {
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(record) + record.signature
      );
      currentLevel.push({
        hash,
        data: record
      });
    }

    // Build tree bottom-up
    while (currentLevel.length > 1) {
      const nextLevel: MerkleNode[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left; // Duplicate if odd

        const parentHash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          left.hash + right.hash
        );
        nextLevel.push({
          hash: parentHash,
          left,
          right: right !== left ? right : undefined
        });
      }

      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  private calculateStats(records: SpeedRecord[]): {
    avgSpeed: number;
    maxSpeed: number;
    minSpeed: number;
    distance: number;
  } {
    if (records.length === 0) {
      return { avgSpeed: 0, maxSpeed: 0, minSpeed: 0, distance: 0 };
    }

    const speeds = records.map(r => r.speed);
    const avgSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
    const maxSpeed = Math.max(...speeds);
    const minSpeed = Math.min(...speeds);

    // Calculate distance using GPS coordinates
    let totalDistance = 0;
    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1];
      const curr = records[i];
      totalDistance += this.calculateDistance(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude
      );
    }

    return {
      avgSpeed: Math.round(avgSpeed),
      maxSpeed: Math.round(maxSpeed),
      minSpeed: Math.round(minSpeed),
      distance: Math.round(totalDistance * 1609.34) // Convert miles to meters
    };
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Haversine formula for distance in miles
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private async storeCheckpoint(
    checkpoint: CheckpointData,
    merkleTree: MerkleNode,
    records: SpeedRecord[]
  ): Promise<void> {
    try {
      // Store checkpoint metadata
      const existingCheckpoints = await AsyncStorage.getItem(CHECKPOINT_STORAGE_KEY);
      const checkpoints: CheckpointData[] = existingCheckpoints ? JSON.parse(existingCheckpoints) : [];
      checkpoints.push(checkpoint);

      // Keep only last 24 hours of checkpoints
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const filteredCheckpoints = checkpoints.filter(c => c.endTime > oneDayAgo);

      await AsyncStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(filteredCheckpoints));

      // Store full tree and records for proof generation
      const treeKey = `merkle_tree_${checkpoint.merkleRoot}`;
      const recordsKey = `records_${checkpoint.merkleRoot}`;

      await AsyncStorage.setItem(treeKey, JSON.stringify(merkleTree));
      await AsyncStorage.setItem(recordsKey, JSON.stringify(records));

    } catch (error) {
      console.error('Failed to store checkpoint:', error);
    }
  }

  public async getCheckpoints(startTime?: number, endTime?: number): Promise<CheckpointData[]> {
    try {
      const data = await AsyncStorage.getItem(CHECKPOINT_STORAGE_KEY);
      if (!data) return [];

      const checkpoints: CheckpointData[] = JSON.parse(data);
      
      if (startTime || endTime) {
        return checkpoints.filter(checkpoint => 
          (!startTime || checkpoint.endTime >= startTime) &&
          (!endTime || checkpoint.startTime <= endTime)
        );
      }

      return checkpoints;
    } catch (error) {
      console.error('Failed to get checkpoints:', error);
      return [];
    }
  }

  public async generateMerkleProof(recordTimestamp: number, merkleRoot: string): Promise<MerkleProof | null> {
    try {
      // Load the tree and records for this checkpoint
      const treeKey = `merkle_tree_${merkleRoot}`;
      const recordsKey = `records_${merkleRoot}`;

      const treeData = await AsyncStorage.getItem(treeKey);
      const recordsData = await AsyncStorage.getItem(recordsKey);

      if (!treeData || !recordsData) {
        console.error('Tree or records not found for root:', merkleRoot);
        return null;
      }

      const tree: MerkleNode = JSON.parse(treeData);
      const records: SpeedRecord[] = JSON.parse(recordsData);

      // Find the target record
      const targetRecord = records.find(r => Math.abs(r.timestamp - recordTimestamp) < 1000);
      if (!targetRecord) {
        console.error('Target record not found');
        return null;
      }

      // Generate proof path
      const leafHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(targetRecord) + targetRecord.signature
      );
      const proof = this.generateProofPath(tree, leafHash);

      if (!proof) return null;

      return {
        leaf: leafHash,
        path: proof.path,
        indices: proof.indices,
        root: merkleRoot
      };

    } catch (error) {
      console.error('Failed to generate Merkle proof:', error);
      return null;
    }
  }

  private generateProofPath(node: MerkleNode, targetHash: string): { path: string[], indices: number[] } | null {
    // Find path to target leaf and collect sibling hashes
    const path: string[] = [];
    const indices: number[] = [];

    const findPath = (current: MerkleNode, target: string, index: number): boolean => {
      if (current.hash === target) {
        return true;
      }

      if (!current.left && !current.right) {
        return false; // Leaf node, not our target
      }

      // Check left subtree
      if (current.left && findPath(current.left, target, index * 2)) {
        if (current.right) {
          path.push(current.right.hash);
          indices.push(index * 2 + 1);
        }
        return true;
      }

      // Check right subtree
      if (current.right && findPath(current.right, target, index * 2 + 1)) {
        path.push(current.left!.hash);
        indices.push(index * 2);
        return true;
      }

      return false;
    };

    const found = findPath(node, targetHash, 0);
    return found ? { path, indices } : null;
  }

  public async verifyMerkleProof(proof: MerkleProof): Promise<boolean> {
    try {
      let hash = proof.leaf;

      for (let i = 0; i < proof.path.length; i++) {
        const sibling = proof.path[i];
        const index = proof.indices[i];

        // Determine if sibling is left or right
        if (index % 2 === 0) {
          // Sibling is left, current hash is right
          hash = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            sibling + hash
          );
        } else {
          // Sibling is right, current hash is left
          hash = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            hash + sibling
          );
        }
      }

      return hash === proof.root;

    } catch (error) {
      console.error('Failed to verify Merkle proof:', error);
      return false;
    }
  }

  public async getCheckpointForTime(timestamp: number): Promise<CheckpointData | null> {
    try {
      const checkpoints = await this.getCheckpoints();
      return checkpoints.find(checkpoint => 
        timestamp >= checkpoint.startTime && timestamp <= checkpoint.endTime
      ) || null;
    } catch (error) {
      console.error('Failed to get checkpoint for time:', error);
      return null;
    }
  }

  public async forceCheckpoint(): Promise<CheckpointData | null> {
    return this.createCheckpoint();
  }

  public getPendingRecordCount(): number {
    return this.pendingRecords.length;
  }
}

// Singleton instance
let instance: MerkleServiceClass | null = null;

export const getMerkleService = (): MerkleServiceClass => {
  if (!instance) {
    instance = new MerkleServiceClass();
  }
  return instance;
};

export default MerkleServiceClass;