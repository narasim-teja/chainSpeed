import * as Location from 'expo-location';
import { getBlockchainService } from './BlockchainService';

/**
 * Service for aggregating anonymous driving data for monetization
 * Focuses on city-level safe driving statistics without personal data
 */

interface CityStats {
  cityName: string;
  safeMiles: number;
  totalMiles: number;
  safetyPercentage: number;
  lastUpdated: number;
}

interface AggregationBatch {
  city: string;
  safeMiles: number;
  totalMiles: number;
  recordCount: number;
}

class DataAggregationService {
  private pendingBatches: Map<string, AggregationBatch> = new Map();
  private readonly BATCH_SIZE = 10; // Process every 10 miles
  private readonly UPDATE_INTERVAL = 300000; // 5 minutes
  private updateTimer: NodeJS.Timeout | null = null;

  /**
   * Initialize the aggregation service
   */
  public async initialize(): Promise<void> {
    console.log('🏙️ Initializing Data Aggregation Service...');
    
    // Start periodic batch processing
    this.startBatchProcessing();
    
    console.log('✅ Data Aggregation Service initialized');
  }

  /**
   * Process a speed record for aggregation (called by SpeedTrackingService)
   */
  public async processSpeedRecord(
    latitude: number,
    longitude: number,
    speed: number,
    distance: number // in meters
  ): Promise<void> {
    try {
      // Get city name from coordinates
      const cityName = await this.getCityFromCoordinates(latitude, longitude);
      if (!cityName) return;

      // Convert meters to miles
      const miles = distance / 1609;
      const safeMiles = speed <= 75 ? miles : 0; // 75 mph safe speed limit

      // Add to pending batch
      const existingBatch = this.pendingBatches.get(cityName) || {
        city: cityName,
        safeMiles: 0,
        totalMiles: 0,
        recordCount: 0
      };

      existingBatch.safeMiles += safeMiles;
      existingBatch.totalMiles += miles;
      existingBatch.recordCount += 1;

      this.pendingBatches.set(cityName, existingBatch);

      console.log(`📊 Aggregated data for ${cityName}: ${miles.toFixed(2)} miles (${safeMiles > 0 ? 'safe' : 'over limit'})`);

    } catch (error) {
      console.warn('Failed to process speed record for aggregation:', error);
    }
  }

  /**
   * Get city name from coordinates using reverse geocoding
   */
  private async getCityFromCoordinates(latitude: number, longitude: number): Promise<string | null> {
    try {
      // Use Expo Location for reverse geocoding
      const reverseGeocode = await Location.reverseGeocodeAsync({
        latitude,
        longitude
      });

      if (reverseGeocode && reverseGeocode.length > 0) {
        const location = reverseGeocode[0];
        
        // Create city identifier (city, state for US locations)
        const city = location.city || location.subregion;
        const state = location.region;
        
        if (city && state) {
          return `${city}, ${state}`;
        } else if (city) {
          return city;
        }
      }

      return null;
    } catch (error) {
      console.warn('Reverse geocoding failed:', error);
      return null;
    }
  }

  /**
   * Start periodic batch processing to update blockchain
   */
  private startBatchProcessing(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    this.updateTimer = setInterval(async () => {
      await this.processPendingBatches();
    }, this.UPDATE_INTERVAL);
  }

  /**
   * Process pending batches and update blockchain
   */
  private async processPendingBatches(): Promise<void> {
    if (this.pendingBatches.size === 0) return;

    console.log(`🔄 Processing ${this.pendingBatches.size} city aggregation batches...`);

    try {
      const blockchainService = getBlockchainService();
      
      for (const [cityName, batch] of this.pendingBatches.entries()) {
        // Only process batches with meaningful data
        if (batch.totalMiles >= 1) { // At least 1 mile
          try {
            await this.updateCityStatsOnChain(cityName, batch.safeMiles, batch.totalMiles);
            console.log(`✅ Updated ${cityName}: ${batch.safeMiles.toFixed(1)}/${batch.totalMiles.toFixed(1)} safe miles`);
          } catch (error) {
            console.warn(`Failed to update ${cityName} stats:`, error);
            continue; // Keep batch for retry
          }
        }
      }

      // Clear processed batches
      this.pendingBatches.clear();

    } catch (error) {
      console.error('Batch processing failed:', error);
    }
  }

  /**
   * Update city statistics on blockchain
   */
  private async updateCityStatsOnChain(city: string, safeMiles: number, totalMiles: number): Promise<void> {
    try {
      const blockchainService = getBlockchainService();
      
      // Call XPRewards contract to update city stats
      // This would be implemented when blockchain service supports XP contract
      console.log(`📤 Would update blockchain: ${city} - ${safeMiles}/${totalMiles} miles`);
      
      // For now, just log the aggregated data
      // In production, this would call: xpContract.updateCityStats(city, safeMiles, totalMiles)
      
    } catch (error) {
      console.error('Failed to update city stats on blockchain:', error);
      throw error;
    }
  }

  /**
   * Get local city statistics (for testing/debugging)
   */
  public getLocalCityStats(): CityStats[] {
    const stats: CityStats[] = [];
    
    for (const [cityName, batch] of this.pendingBatches.entries()) {
      stats.push({
        cityName,
        safeMiles: batch.safeMiles,
        totalMiles: batch.totalMiles,
        safetyPercentage: batch.totalMiles > 0 ? (batch.safeMiles / batch.totalMiles) * 100 : 0,
        lastUpdated: Date.now()
      });
    }
    
    return stats;
  }

  /**
   * Get aggregated insights for data buyers (anonymized)
   */
  public async getDataInsights(): Promise<{
    totalCities: number;
    totalSafeMiles: number;
    totalMiles: number;
    overallSafetyRate: number;
    topSafeCities: string[];
  }> {
    const cityStats = this.getLocalCityStats();
    
    const totalSafeMiles = cityStats.reduce((sum, city) => sum + city.safeMiles, 0);
    const totalMiles = cityStats.reduce((sum, city) => sum + city.totalMiles, 0);
    
    // Sort cities by safety percentage
    const sortedCities = cityStats
      .filter(city => city.totalMiles >= 10) // Minimum 10 miles for ranking
      .sort((a, b) => b.safetyPercentage - a.safetyPercentage)
      .slice(0, 5) // Top 5
      .map(city => city.cityName);

    return {
      totalCities: cityStats.length,
      totalSafeMiles,
      totalMiles,
      overallSafetyRate: totalMiles > 0 ? (totalSafeMiles / totalMiles) * 100 : 0,
      topSafeCities: sortedCities
    };
  }

  /**
   * Force process all pending batches (for testing)
   */
  public async forceBatchProcessing(): Promise<void> {
    await this.processPendingBatches();
  }

  /**
   * Cleanup service
   */
  public cleanup(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    this.pendingBatches.clear();
    console.log('🧹 Data Aggregation Service cleaned up');
  }
}

// Singleton instance
let aggregationInstance: DataAggregationService | null = null;

export const getDataAggregationService = (): DataAggregationService => {
  if (!aggregationInstance) {
    aggregationInstance = new DataAggregationService();
  }
  return aggregationInstance;
};

export default DataAggregationService;