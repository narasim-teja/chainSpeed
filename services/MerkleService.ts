import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpeedRecord } from './LocationService';
import { getBlockchainService } from './BlockchainService';
import { getSecureJSON, setSecureJSON } from './storage/secureStorage';
import { CHECKPOINT_RETENTION_MS, staleBundleKeys } from './storage/retention';
import { buildRecordTree, recordLeaf, recordProof, verifyRecordProof, type LeafRecord } from './identity/recordTree';

/** Inclusion proof for one record, verifiable on chain with SpeedRegistry.verifyRecord. */
export interface MerkleProof {
  device: string;
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
  device: string; // the wallet the tree's leaves are bound to
}

const CHECKPOINT_STORAGE_KEY = 'merkle_checkpoints';
const CHECKPOINT_INTERVAL = 30000; // 30 seconds in milliseconds

class MerkleServiceClass {
  private pendingRecords: SpeedRecord[] = [];
  private creation: Promise<unknown> = Promise.resolve();
  private lastCheckpointTime = 0;

  constructor() {
    this.startCheckpointTimer();
    // Apply retention at startup too, so old records are deleted even if no new drive happens.
    // Queued like checkpoint creation, so it can never prune a bundle that is being written.
    this.creation = this.pruneExpired().catch((error) => console.warn('Retention cleanup failed:', error));
  }

  /** Drops checkpoints past the retention period, and the record bundles behind them (F20). */
  private async pruneExpired(): Promise<void> {
    const checkpoints = (await getSecureJSON<CheckpointData[]>(CHECKPOINT_STORAGE_KEY)) ?? [];
    const cutoff = Date.now() - CHECKPOINT_RETENTION_MS;
    const kept = checkpoints.filter((c) => c.endTime > cutoff);
    if (kept.length !== checkpoints.length) await setSecureJSON(CHECKPOINT_STORAGE_KEY, kept);
    await this.pruneBundles(new Set(kept.map((c) => c.merkleRoot)));
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

  /** Checkpoints are created one at a time, so the 30-second timer and Stop can never overlap. */
  private createCheckpoint(): Promise<CheckpointData | null> {
    const run = this.creation.then(() => this.createCheckpointNow());
    this.creation = run.catch(() => null);
    return run;
  }

  private async createCheckpointNow(): Promise<CheckpointData | null> {
    if (this.pendingRecords.length === 0) return null;

    // Leaves are bound to the device (see recordTree.ts), so the wallet must be known.
    const device = await getBlockchainService().getDeviceAddress();
    if (!device) {
      console.warn('No wallet connected: records are held until a device wallet is available');
      return null;
    }

    // Take the batch before anything else awaits: records that arrive while this checkpoint is
    // being stored and submitted belong to the next checkpoint instead of being dropped.
    const batch = this.pendingRecords;
    this.pendingRecords = [];

    try {
      const merkleTree = buildRecordTree(device, batch.map(toLeafRecord));
      const stats = this.calculateStats(batch);
      const firstRecordTime = batch[0].timestamp;
      const lastRecordTime = batch[batch.length - 1].timestamp;
      const endTime = lastRecordTime === firstRecordTime ? firstRecordTime + 1000 : lastRecordTime;

      const checkpoint: CheckpointData = {
        merkleRoot: merkleTree.root,
        device,
        startTime: firstRecordTime,
        endTime,
        avgSpeed: stats.avgSpeed,
        maxSpeed: stats.maxSpeed,
        minSpeed: stats.minSpeed,
        distanceMeters: stats.distance,
        recordCount: batch.length,
      };

      // A root whose records cannot be kept proves nothing, so don't anchor it (fail closed).
      try {
        await this.storeCheckpoint(checkpoint, merkleTree.tree, batch);
      } catch (error) {
        console.error('Could not store checkpoint records; not anchoring this checkpoint:', error);
        return null;
      }

      const txHash = await getBlockchainService().submitCheckpoint(checkpoint);
      console.log('Checkpoint created:', {
        root: checkpoint.merkleRoot.substring(0, 10) + '...',
        records: checkpoint.recordCount,
        timespan: (checkpoint.endTime - checkpoint.startTime) / 1000 + 's',
        result: txHash ? txHash.substring(0, 10) + '...' : 'unanchored',
      });
      this.lastCheckpointTime = Date.now();
      return checkpoint;
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

      // Keep checkpoints (and the records behind their proofs) for the retention period (F20)
      const cutoff = Date.now() - CHECKPOINT_RETENTION_MS;
      const filteredCheckpoints = checkpoints.filter(c => c.endTime > cutoff);

      await setSecureJSON(CHECKPOINT_STORAGE_KEY, filteredCheckpoints);

      // Store full tree and records for proof generation
      const treeKey = `merkle_tree_${checkpoint.merkleRoot}`;
      const recordsKey = `records_${checkpoint.merkleRoot}`;

      await AsyncStorage.setItem(treeKey, JSON.stringify(merkleTree));
      await setSecureJSON(recordsKey, records); // raw GPS: encrypted at rest

      // Delete bundles whose checkpoint aged out, and any orphans left by older versions
      await this.pruneBundles(new Set(filteredCheckpoints.map((c) => c.merkleRoot)));

    } catch (error) {
      console.error('Failed to store checkpoint:', error);
      throw error;
    }
  }

  private async pruneBundles(retainedRoots: Set<string>): Promise<void> {
    const stale = staleBundleKeys(await AsyncStorage.getAllKeys(), retainedRoots);
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
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
      await this.pruneBundles(new Set()); // the records behind them too
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
      const device = (await this.getCheckpoints()).find((c) => c.merkleRoot === merkleRoot)?.device;
      if (!device) return null; // a tree from before leaves were bound to the device

      const target = records.find((r) => Math.abs(r.timestamp - recordTimestamp) < 1000);
      if (!target || !target.salt) {
        console.error('Target record not found');
        return null;
      }
      const record = toLeafRecord(target);
      const leaf = recordLeaf(device as `0x${string}`, record);
      return { device, leaf, path: recordProof(tree, leaf), root: merkleRoot, record };
    } catch (error) {
      console.error('Failed to generate Merkle proof:', error);
      return null;
    }
  }

  /** A proof for the first record of a checkpoint, used to spot-check it on chain. */
  public async generateSampleProof(merkleRoot: string): Promise<MerkleProof | null> {
    const records = await getSecureJSON<SpeedRecord[]>(`records_${merkleRoot}`);
    const first = records?.find((r) => r.salt);
    return first ? this.generateMerkleProof(first.timestamp, merkleRoot) : null;
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
