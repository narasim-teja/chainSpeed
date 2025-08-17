import { getBlockchainService } from './BlockchainService';
import { getDataAggregationService } from './DataAggregationService';

/**
 * Service for managing XP rewards and drive-to-earn functionality
 */

export interface UserXPStats {
  totalXP: number;
  lifetimeMiles: number;
  safeMiles: number;
  currentStreak: number;
  driveToEarnEnabled: boolean;
}

export interface GiftCardOption {
  provider: string;
  value: number;
  cost: number;
}

export interface UserGiftCard {
  provider: string;
  value: number;
  code: string;
  redeemed: boolean;
  redeemedAt: number;
}

class XPService {
  private driveToEarnEnabled: boolean = false;
  private pendingXP: number = 0;
  private lastProcessedCheckpoint: number = 0;
  private userAddress: string | null = null;

  /**
   * Initialize XP service
   */
  public async initialize(): Promise<void> {
    console.log('🎯 Initializing XP Service...');
    
    // Load user's drive-to-earn preference
    await this.loadDriveToEarnPreference();
    
    console.log('✅ XP Service initialized');
  }

  /**
   * Toggle drive-to-earn feature
   */
  public async toggleDriveToEarn(enabled: boolean): Promise<boolean> {
    try {
      console.log(`${enabled ? '🟢' : '🔴'} Toggling drive-to-earn: ${enabled}`);
      
      this.driveToEarnEnabled = enabled;
      
      // Save preference locally
      await this.saveDriveToEarnPreference(enabled);
      
      // Update blockchain contract
      const blockchainService = getBlockchainService();
      const isConnected = await blockchainService.checkConnection();
      if (isConnected) {
        try {
          await blockchainService.toggleDriveToEarn(enabled);
          console.log('✅ Blockchain drive-to-earn preference updated');
        } catch (error) {
          console.warn('Failed to update blockchain preference:', error);
          // Continue with local state - will sync later
        }
      }
      
      console.log(`✅ Drive-to-earn ${enabled ? 'enabled' : 'disabled'}`);
      return true;
      
    } catch (error) {
      console.error('Failed to toggle drive-to-earn:', error);
      return false;
    }
  }

  /**
   * Process speed records for XP calculation
   */
  public async processSpeedRecordForXP(
    speed: number,
    distance: number, // in meters
    latitude: number,
    longitude: number
  ): Promise<number> {
    if (!this.driveToEarnEnabled) {
      return 0;
    }

    try {
      const miles = distance / 1609; // Convert meters to miles
      const SAFE_SPEED_LIMIT = 75; // mph
      
      let xpEarned = 0;
      
      // Award XP only for safe driving (under speed limit)
      if (speed <= SAFE_SPEED_LIMIT && miles > 0) {
        xpEarned = Math.floor(miles * 1); // 1 XP per safe mile
        this.pendingXP += xpEarned;
        
        console.log(`🎯 Earned ${xpEarned} XP for ${miles.toFixed(2)} safe miles at ${speed} mph`);
      } else if (miles > 0) {
        console.log(`⚠️ No XP earned - driving ${speed} mph (over ${SAFE_SPEED_LIMIT} mph limit)`);
      }

      // Also process for data aggregation
      const aggregationService = getDataAggregationService();
      await aggregationService.processSpeedRecord(latitude, longitude, speed, distance);
      
      return xpEarned;
      
    } catch (error) {
      console.error('Failed to process speed record for XP:', error);
      return 0;
    }
  }

  /**
   * Submit accumulated XP to blockchain (called after checkpoint submission)
   */
  public async submitXPToBlockchain(): Promise<boolean> {
    if (!this.driveToEarnEnabled || this.pendingXP === 0) {
      return true;
    }

    try {
      console.log(`📤 Submitting ${this.pendingXP} XP to blockchain...`);
      
      const blockchainService = getBlockchainService();
      const isConnected = await blockchainService.checkConnection();
      if (isConnected) {
        await blockchainService.processCheckpointsForXP();
        
        // Reset pending XP after successful submission
        this.pendingXP = 0;
        console.log('✅ XP submitted to blockchain');
        return true;
      } else {
        console.warn('Blockchain not connected - XP will be submitted later');
        return false;
      }
      
    } catch (error) {
      console.error('Failed to submit XP to blockchain:', error);
      return false;
    }
  }

  /**
   * Get user's XP statistics
   */
  public async getUserXPStats(): Promise<UserXPStats> {
    try {
      const blockchainService = getBlockchainService();
      const isConnected = await blockchainService.checkConnection();
      
      if (isConnected) {
        // Get user's wallet address
        const userAddress = await this.getUserAddress();
        if (userAddress) {
          const stats = await blockchainService.getUserXP(userAddress);
          return {
            totalXP: stats.totalXP + this.pendingXP, // Include pending XP
            lifetimeMiles: stats.lifetimeMiles,
            safeMiles: stats.safeMiles,
            currentStreak: stats.currentStreak,
            driveToEarnEnabled: stats.driveToEarnEnabled
          };
        }
      }
      
      // Return local/cached data if blockchain not available
      return {
        totalXP: this.pendingXP,
        lifetimeMiles: 0,
        safeMiles: 0,
        currentStreak: 0,
        driveToEarnEnabled: this.driveToEarnEnabled
      };
      
    } catch (error) {
      console.error('Failed to get user XP stats:', error);
      return {
        totalXP: this.pendingXP,
        lifetimeMiles: 0,
        safeMiles: 0,
        currentStreak: 0,
        driveToEarnEnabled: this.driveToEarnEnabled
      };
    }
  }

  /**
   * Get available gift card options
   */
  public getGiftCardOptions(): GiftCardOption[] {
    return [
      { provider: 'TARGET', value: 10, cost: 1000 },
      { provider: 'TARGET', value: 50, cost: 5000 },
      { provider: 'NETFLIX', value: 10, cost: 1000 },
      { provider: 'NETFLIX', value: 50, cost: 5000 }
    ];
  }

  /**
   * Redeem XP for gift card
   */
  public async redeemGiftCard(provider: string, value: number): Promise<UserGiftCard | null> {
    try {
      const options = this.getGiftCardOptions();
      const option = options.find(opt => opt.provider === provider && opt.value === value);
      
      if (!option) {
        throw new Error('Invalid gift card option');
      }

      const userStats = await this.getUserXPStats();
      if (userStats.totalXP < option.cost) {
        throw new Error(`Insufficient XP. Need ${option.cost}, have ${userStats.totalXP}`);
      }

      console.log(`🎁 Redeeming ${provider} $${value} gift card for ${option.cost} XP...`);
      
      const blockchainService = getBlockchainService();
      const isConnected = await blockchainService.checkConnection();
      if (isConnected) {
        await blockchainService.redeemGiftCard(provider, value);
        
        // Get the redeemed gift card from blockchain
        const userAddress = await this.getUserAddress();
        if (userAddress) {
          const giftCards = await blockchainService.getUserGiftCards(userAddress);
          const latestCard = giftCards[giftCards.length - 1]; // Get most recent
          
          if (latestCard) {
            const giftCard: UserGiftCard = {
              provider: latestCard.provider,
              value: latestCard.value,
              code: latestCard.code,
              redeemed: latestCard.redeemed,
              redeemedAt: latestCard.redeemedAt
            };
            
            console.log(`✅ Gift card redeemed: ${giftCard.code}`);
            return giftCard;
          }
        }
        
        // Fallback to mock data if blockchain read fails
        const giftCard: UserGiftCard = {
          provider,
          value,
          code: `${provider}-${this.generateMockCode()}`,
          redeemed: true,
          redeemedAt: Date.now()
        };
        
        return giftCard;
      } else {
        throw new Error('Blockchain not connected - cannot redeem gift card');
      }
      
    } catch (error) {
      console.error('Failed to redeem gift card:', error);
      throw error;
    }
  }

  /**
   * Get user's redeemed gift cards
   */
  public async getUserGiftCards(): Promise<UserGiftCard[]> {
    try {
      const blockchainService = getBlockchainService();
      const isConnected = await blockchainService.checkConnection();
      
      if (isConnected) {
        const userAddress = await this.getUserAddress();
        if (userAddress) {
          const giftCards = await blockchainService.getUserGiftCards(userAddress);
          return giftCards.map(card => ({
            provider: card.provider,
            value: card.value,
            code: card.code,
            redeemed: card.redeemed,
            redeemedAt: card.redeemedAt
          }));
        }
      }
      
      return [];
      
    } catch (error) {
      console.error('Failed to get user gift cards:', error);
      return [];
    }
  }

  /**
   * Check if drive-to-earn is enabled
   */
  public isDriveToEarnEnabled(): boolean {
    return this.driveToEarnEnabled;
  }

  /**
   * Get pending XP (not yet submitted to blockchain)
   */
  public getPendingXP(): number {
    return this.pendingXP;
  }

  /**
   * Generate mock gift card code
   */
  private generateMockCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 9; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Save drive-to-earn preference locally
   */
  private async saveDriveToEarnPreference(enabled: boolean): Promise<void> {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem('drive_to_earn_enabled', JSON.stringify(enabled));
    } catch (error) {
      console.warn('Failed to save drive-to-earn preference:', error);
    }
  }

  /**
   * Load drive-to-earn preference from local storage
   */
  private async loadDriveToEarnPreference(): Promise<void> {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const stored = await AsyncStorage.getItem('drive_to_earn_enabled');
      if (stored !== null) {
        this.driveToEarnEnabled = JSON.parse(stored);
        console.log(`📱 Loaded drive-to-earn preference: ${this.driveToEarnEnabled}`);
      }
    } catch (error) {
      console.warn('Failed to load drive-to-earn preference:', error);
    }
  }

  /**
   * Get user's wallet address from stored value
   */
  private async getUserAddress(): Promise<string | null> {
    return this.userAddress;
  }

  /**
   * Set the user address for XP operations (called from components with Privy access)
   */
  public setUserAddress(address: string | null): void {
    this.userAddress = address;
  }

  /**
   * Get stored user address
   */
  public getUserAddressSync(): string | null {
    return this.userAddress;
  }
}

// Singleton instance
let xpInstance: XPService | null = null;

export const getXPService = (): XPService => {
  if (!xpInstance) {
    xpInstance = new XPService();
  }
  return xpInstance;
};

export default XPService;