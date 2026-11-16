import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpeedRecord } from './LocationService';
import { getCryptoService, SignedData } from './CryptoService';
import { getBlockchainService } from './BlockchainService';
import { getSecureJSON, setSecureJSON } from './storage/secureStorage';
import { buildRecordTree, recordLeaf, recordProof, verifyRecordProof, type LeafRecord } from './identity/recordTree';

/** Inclusion proof for one record, verifiable on chain with SpeedRegistry.verifyRecord. */
export interface MerkleProof {
  leaf: string;
  path: string[];
  root: string;
  record: LeafRecord;
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
      const merkleTree = buildRecordTree(this.pendingRecords.map(toLeafRecord));

      // Calculate checkpoint statistics
      const stats = this.calculateStats(this.pendingRecords);

      // Create checkpoint data
      const firstRecordTime = this.pendingRecords[0].timestamp;
      const lastRecordTime = this.pendingRecords[this.pendingRecords.length - 1].timestamp;
      
      // Ensure endTime is always greater than startTime (smart contract requirement)
      const endTime = lastRecordTime === firstRecordTime ? firstRecordTime + 1000 : lastRecordTime; // Add 1 second if they're equal
      
      const checkpointData: Omit<CheckpointData, 'signature'> = {
        merkleRoot: merkleTree.root,
        startTime: firstRecordTime,
        endTime: endTime,
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
      await this.storeCheckpoint(finalCheckpoint, merkleTree.tree, this.pendingRecords);

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

    // Debug negative speeds
    const negativeSpeedCount = speeds.filter(s => s < 0).length;
    if (negativeSpeedCount > 0) {
      console.warn(`Found ${negativeSpeedCount} negative speeds in checkpoint`, {
        minSpeed,
        avgSpeed,
        maxSpeed,
        speedRange: [Math.min(...speeds), Math.max(...speeds)]
      });
    }

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
      avgSpeed: Math.max(0, Math.round(avgSpeed)), // Ensure non-negative
      maxSpeed: Math.max(0, Math.round(maxSpeed)), // Ensure non-negative
      minSpeed: Math.max(0, Math.round(minSpeed)), // Ensure non-negative
      distance: Math.max(0, Math.round(totalDistance * 1609.34)) // Convert miles to meters, ensure non-negative
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
    merkleTree: string[],
    records: SpeedRecord[]
  ): Promise<void> {
    try {
      // Store checkpoint metadata
      const checkpoints: CheckpointData[] = (await getSecureJSON<CheckpointData[]>(CHECKPOINT_STORAGE_KEY)) ?? [];
      checkpoints.push(checkpoint);

      // Keep only last 24 hours of checkpoints
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const filteredCheckpoints = checkpoints.filter(c => c.endTime > oneDayAgo);

      await setSecureJSON(CHECKPOINT_STORAGE_KEY, filteredCheckpoints);

      // Store full tree and records for proof generation
      const treeKey = `merkle_tree_${checkpoint.merkleRoot}`;
      const recordsKey = `records_${checkpoint.merkleRoot}`;

      await AsyncStorage.setItem(treeKey, JSON.stringify(merkleTree));
      await setSecureJSON(recordsKey, records); // raw GPS: encrypted at rest

    } catch (error) {
      console.error('Failed to store checkpoint:', error);
    }
  }

  public async getCheckpoints(startTime?: number, endTime?: number): Promise<CheckpointData[]> {
    try {
      const checkpoints = await getSecureJSON<CheckpointData[]>(CHECKPOINT_STORAGE_KEY);
      if (!checkpoints) return [];
      
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

  /**
   * Clear all stored checkpoints (for manual cleanup)
   */
  public async clearAllCheckpoints(): Promise<void> {
    try {
      await AsyncStorage.removeItem(CHECKPOINT_STORAGE_KEY);
      console.log('✅ All local checkpoints cleared');
    } catch (error) {
      console.error('Failed to clear checkpoints:', error);
      throw error;
    }
  }

  public async generateMerkleProof(recordTimestamp: number, merkleRoot: string): Promise<MerkleProof | null> {
    try {
      const treeData = await AsyncStorage.getItem(`merkle_tree_${merkleRoot}`);
      const records = await getSecureJSON<SpeedRecord[]>(`records_${merkleRoot}`);
      if (!treeData || !records) {
        console.error('Tree or records not found for root:', merkleRoot);
        return null;
      }
      const tree = JSON.parse(treeData);
      if (!Array.isArray(tree)) return null; // a tree from before the standard-tree format

      const target = records.find((r) => Math.abs(r.timestamp - recordTimestamp) < 1000);
      if (!target || !target.salt) {
        console.error('Target record not found');
        return null;
      }
      const record = toLeafRecord(target);
      const leaf = recordLeaf(record);
      return { leaf, path: recordProof(tree, leaf), root: merkleRoot, record };
    } catch (error) {
      console.error('Failed to generate Merkle proof:', error);
      return null;
    }
  }

  /** Local check of a proof; SpeedRegistry.verifyRecord is the authoritative one. */
  public async verifyMerkleProof(proof: MerkleProof): Promise<boolean> {
    return verifyRecordProof(proof.root as `0x${string}`, proof.leaf as `0x${string}`, proof.path as `0x${string}`[]);
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
/** The fields of a record that its checkpoint commits to. */
function toLeafRecord(record: SpeedRecord): LeafRecord {
  return {
    timestamp: record.timestamp,
    latitude: record.latitude,
    longitude: record.longitude,
    speed: record.speed,
    accuracy: record.accuracy,
    salt: record.salt as `0x${string}`,
  };
}
