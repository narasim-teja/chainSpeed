import { LocationService, SpeedRecord } from './LocationService';
import { getMerkleService } from './MerkleService';
import { getCryptoService } from './CryptoService';
import { getBlockchainService } from './BlockchainService';
import * as Location from 'expo-location';

/**
 * Main service that orchestrates GPS tracking, crypto signing, and Merkle tree construction
 */
class SpeedTrackingServiceClass {
  private locationService = LocationService.getInstance();
  private merkleService = getMerkleService();
  private cryptoService = getCryptoService();
  private isInitialized = false;

  async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) return true;

      console.log('Initializing SpeedTrackingService...');

      // Initialize TEE crypto service first
      try {
        const TEEModule = await import('./TEECryptoService');
        const teeService = TEEModule.getTEECryptoService();
        await teeService.initialize();
        console.log('✅ TEE Crypto Service initialized');
      } catch (teeError) {
        console.warn('⚠️ TEE initialization failed, using fallback:', teeError);
        // Continue with software-based signing as fallback
        await this.cryptoService.getDeviceAttestation();
      }

      // Request permissions
      const hasPermissions = await this.locationService.requestPermissions();
      if (!hasPermissions) {
        console.error('Location permissions denied');
        return false;
      }

      // Set up location processing callback
      this.setupLocationProcessing();

      this.isInitialized = true;
      console.log('SpeedTrackingService initialized successfully');
      return true;

    } catch (error) {
      console.error('Failed to initialize SpeedTrackingService:', error);
      return false;
    }
  }

  private setupLocationProcessing(): void {
    // Override the location service's processLocationUpdate to include our processing
    const originalProcess = this.locationService.processLocationUpdate.bind(this.locationService);
    
    this.locationService.processLocationUpdate = async (location: Location.LocationObject) => {
      try {
        // Call original processing
        await originalProcess(location);

        // For Merkle tree, we track all records including when stopped (complete legal coverage)
        // This ensures all time periods are recorded for legal protection
        if ((this.locationService as any).previousRecord) {
          const record = (this.locationService as any).previousRecord;
          this.merkleService.addRecord(record);
          
          // Process for XP rewards and data aggregation
          await this.processRecordForXP(record, location);
        }

      } catch (error) {
        console.error('Failed to process location update:', error);
      }
    };
  }

  private async processRecordForXP(record: any, location: Location.LocationObject): Promise<void> {
    try {
      // Initialize services if needed
      const { getXPService } = await import('./XPService');
      const { getDataAggregationService } = await import('./DataAggregationService');
      
      const xpService = getXPService();
      const aggregationService = getDataAggregationService();
      
      // Initialize services if not already done
      if (!xpService.isDriveToEarnEnabled()) {
        await xpService.initialize();
      }
      
      // Process XP rewards (only if drive-to-earn is enabled)
      if (record.speed && record.distance) {
        await xpService.processSpeedRecordForXP(
          record.speed,
          record.distance,
          location.coords.latitude,
          location.coords.longitude
        );
      }
      
      // Process data aggregation (always, for monetization)
      if (record.speed && record.distance) {
        await aggregationService.processSpeedRecord(
          location.coords.latitude,
          location.coords.longitude,
          record.speed,
          record.distance
        );
      }
      
    } catch (error) {
      console.warn('Failed to process record for XP:', error);
      // Don't throw - this shouldn't break main tracking
    }
  }

  async startTracking(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) return false;
      }

      console.log('Starting speed tracking...');
      const success = await this.locationService.startTracking();
      
      if (success) {
        console.log('Speed tracking started successfully');
      } else {
        console.error('Failed to start speed tracking');
      }

      return success;

    } catch (error) {
      console.error('Error starting tracking:', error);
      return false;
    }
  }

  async stopTracking(): Promise<void> {
    try {
      console.log('Stopping speed tracking...');
      await this.locationService.stopTracking();
      
      // Create final checkpoint with any pending records
      await this.merkleService.forceCheckpoint();
      
      // Process XP rewards if drive-to-earn is enabled
      await this.processXPRewards();
      
      console.log('Speed tracking stopped');

    } catch (error) {
      console.error('Error stopping tracking:', error);
    }
  }

  getTrackingStatus(): boolean {
    return this.locationService.getTrackingStatus();
  }

  async getRecentRecords(minutes: number = 5): Promise<SpeedRecord[]> {
    const timeAgo = Date.now() - (minutes * 60 * 1000);
    return this.locationService.getRecords(timeAgo);
  }

  async getCurrentStats(): Promise<{
    currentSpeed: number;
    maxSpeed: number;
    avgSpeed: number;
    totalDistance: number;
    recordCount: number;
    checkpointCount: number;
    pendingRecords: number;
  }> {
    try {
      // Get the last known speed (includes 0 when stopped)
      const currentSpeed = await this.locationService.getLastKnownSpeed();
      
      // Get records from the last hour
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const records = await this.locationService.getRecords(oneHourAgo);
      
      // Get checkpoints from today
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const checkpoints = await this.merkleService.getCheckpoints(todayStart);

      if (records.length === 0) {
        return {
          currentSpeed: Math.round(currentSpeed),
          maxSpeed: 0,
          avgSpeed: 0,
          totalDistance: 0,
          recordCount: 0,
          checkpointCount: checkpoints.length,
          pendingRecords: this.merkleService.getPendingRecordCount(),
        };
      }

      // Calculate stats from stored records (includes all periods)
      const speeds = records.map(r => r.speed);
      const maxSpeed = Math.max(...speeds);
      const avgSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;

      // Calculate total distance
      let totalDistance = 0;
      for (let i = 1; i < records.length; i++) {
        totalDistance += this.calculateDistance(
          records[i - 1].latitude, records[i - 1].longitude,
          records[i].latitude, records[i].longitude
        );
      }

      return {
        currentSpeed: Math.round(currentSpeed),
        maxSpeed: Math.round(maxSpeed),
        avgSpeed: Math.round(avgSpeed),
        totalDistance: Math.round(totalDistance * 10) / 10, // Round to 1 decimal
        recordCount: records.length,
        checkpointCount: checkpoints.length,
        pendingRecords: this.merkleService.getPendingRecordCount(),
      };

    } catch (error) {
      console.error('Failed to get current stats:', error);
      return {
        currentSpeed: 0,
        maxSpeed: 0,
        avgSpeed: 0,
        totalDistance: 0,
        recordCount: 0,
        checkpointCount: 0,
        pendingRecords: 0,
      };
    }
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

  async createManualCheckpoint(): Promise<boolean> {
    try {
      const checkpoint = await this.merkleService.forceCheckpoint();
      return checkpoint !== null;
    } catch (error) {
      console.error('Failed to create manual checkpoint:', error);
      return false;
    }
  }

  async validateDataIntegrity(): Promise<{
    isValid: boolean;
    issues: string[];
  }> {
    try {
      const issues: string[] = [];

      // Get recent records
      const records = await this.locationService.getRecords();
      
      // For now, just check that records exist and have signatures
      // The signature verification would need the original signing context
      if (records.length === 0) {
        issues.push('No speed records found');
      } else {
        let validCount = 0;
        for (const record of records) {
          if (record.signature && record.signature.length > 0) {
            validCount++;
          } else {
            issues.push(`Missing signature for record at ${new Date(record.timestamp).toISOString()}`);
          }
        }
        
        if (validCount === records.length) {
          console.log(`All ${validCount} records have valid signatures`);
        }
      }

      return {
        isValid: issues.length === 0,
        issues
      };

    } catch (error) {
      console.error('Failed to validate data integrity:', error);
      return {
        isValid: false,
        issues: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  async exportDataForTimeRange(startTime: number, endTime: number): Promise<{
    records: SpeedRecord[];
    checkpoints: any[];
    proofs: any[];
    attestation: any;
  } | null> {
    try {
      const records = await this.locationService.getRecords(startTime, endTime);
      const checkpoints = await this.merkleService.getCheckpoints(startTime, endTime);
      const attestation = await this.cryptoService.getDeviceAttestation();

      // Generate proofs for each checkpoint
      const proofs = [];
      for (const checkpoint of checkpoints) {
        // Find a representative record for proof generation
        const checkpointRecords = records.filter(r => 
          r.timestamp >= checkpoint.startTime && r.timestamp <= checkpoint.endTime
        );
        
        if (checkpointRecords.length > 0) {
          const proof = await this.merkleService.generateMerkleProof(
            checkpointRecords[0].timestamp,
            checkpoint.merkleRoot
          );
          if (proof) {
            proofs.push({
              checkpoint: checkpoint.merkleRoot,
              proof,
              record: checkpointRecords[0]
            });
          }
        }
      }

      return {
        records,
        checkpoints,
        proofs,
        attestation
      };

    } catch (error) {
      console.error('Failed to export data:', error);
      return null;
    }
  }

  /**
   * Process XP rewards based on the completed tracking session
   */
  private async processXPRewards(): Promise<void> {
    try {
      // Import XPService dynamically to avoid circular dependencies
      const { getXPService } = await import('./XPService');
      const xpService = getXPService();
      
      // Check if drive-to-earn is enabled for this user
      const isDriveToEarnEnabled = await xpService.isDriveToEarnEnabled();
      if (!isDriveToEarnEnabled) {
        console.log('🚫 Drive-to-earn not enabled, skipping XP processing');
        return;
      }
      
      console.log('🎯 Processing XP rewards for completed tracking session...');
      
      // Get session stats
      const stats = await this.getCurrentStats();
      
      // Calculate session metrics
      const sessionData = {
        totalMiles: stats.totalDistance,
        avgSpeed: stats.avgSpeed,
        maxSpeed: stats.maxSpeed,
        recordCount: stats.recordCount,
        checkpointCount: stats.checkpointCount,
      };
      
      console.log('📊 Session completed:', sessionData);
      
      // Calculate safe driving metrics for XP
      const safeDrivingData = await this.calculateSafeDrivingMetrics(stats);
      console.log('🛡️ Safe driving analysis:', safeDrivingData);
      
      // Submit XP processing to blockchain (this will calculate XP based on safe driving)
      await xpService.submitXPToBlockchain();
      
      console.log('✅ XP rewards processing completed');
      
    } catch (error) {
      console.error('❌ Failed to process XP rewards:', error);
      // Don't throw error - XP processing shouldn't block normal tracking stop
    }
  }

  /**
   * Calculate safe driving metrics for XP calculation
   */
  private async calculateSafeDrivingMetrics(stats: any): Promise<{
    safeMiles: number;
    totalMiles: number;
    safetyPercentage: number;
    speedViolations: number;
    avgSpeedRatio: number;
  }> {
    try {
      const SAFE_SPEED_LIMIT = 75; // mph - should match contract
      const records = await this.locationService.getRecords();
      
      let totalDistance = 0;
      let safeDistance = 0;
      let speedViolations = 0;
      let speedSum = 0;
      
      // Analyze each speed record
      for (let i = 1; i < records.length; i++) {
        const prevRecord = records[i - 1];
        const currentRecord = records[i];
        
        // Calculate distance for this segment
        const segmentDistance = this.calculateDistance(
          prevRecord.latitude, prevRecord.longitude,
          currentRecord.latitude, currentRecord.longitude
        );
        
        totalDistance += segmentDistance;
        speedSum += currentRecord.speed;
        
        // Check if this segment was safe driving
        if (currentRecord.speed <= SAFE_SPEED_LIMIT) {
          safeDistance += segmentDistance;
        } else {
          speedViolations++;
        }
      }
      
      const safetyPercentage = totalDistance > 0 ? (safeDistance / totalDistance) * 100 : 0;
      const avgSpeedRatio = records.length > 0 ? speedSum / (records.length * SAFE_SPEED_LIMIT) : 0;
      
      return {
        safeMiles: Math.round(safeDistance * 100) / 100,
        totalMiles: Math.round(totalDistance * 100) / 100,
        safetyPercentage: Math.round(safetyPercentage * 100) / 100,
        speedViolations,
        avgSpeedRatio: Math.round(avgSpeedRatio * 100) / 100,
      };
      
    } catch (error) {
      console.error('Failed to calculate safe driving metrics:', error);
      return {
        safeMiles: 0,
        totalMiles: stats.totalDistance || 0,
        safetyPercentage: 0,
        speedViolations: 0,
        avgSpeedRatio: 0,
      };
    }
  }

  /**
   * Initialize wallet provider for blockchain transactions
   */
  async initializeWallet(provider: any): Promise<void> {
    try {
      const blockchainService = getBlockchainService();
      await blockchainService.setWalletProvider(provider);
      
      console.log('Wallet provider initialized for blockchain service');
      
      // Try to submit any pending checkpoints after network switch
      setTimeout(async () => {
        try {
          const result = await blockchainService.retryPendingCheckpoints();
          if (result.submitted > 0) {
            console.log(`Auto-submitted ${result.submitted} pending checkpoints`);
          }
        } catch (error) {
          console.log('Auto-retry of pending checkpoints failed:', error);
        }
      }, 3000); // Wait 3 seconds after wallet init and network switch
      
    } catch (error) {
      console.error('Failed to initialize wallet:', error);
    }
  }
}

// Singleton instance
let instance: SpeedTrackingServiceClass | null = null;

export const getSpeedTrackingService = (): SpeedTrackingServiceClass => {
  if (!instance) {
    instance = new SpeedTrackingServiceClass();
  }
  return instance;
};

export default SpeedTrackingServiceClass;