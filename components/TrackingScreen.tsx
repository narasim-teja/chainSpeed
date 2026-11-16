import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePrivy, useEmbeddedEthereumWallet, getUserEmbeddedEthereumWallet, useIdentityToken } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import { getSpeedTrackingService } from '../services/SpeedTrackingService';
import { SpeedRecord } from '../services/LocationService';

import { getBlockchainService } from '../services/BlockchainService';
import { getXPService } from '../services/XPService';
import {
  beginDriveSession,
  endDriveSession,
  getDeviceIdentity,
  hasDriveSession,
  isDeviceSupported,
  registerDevice,
} from '../services/identity/deviceRegistration';


interface TrackingStats {
  currentSpeed: number;
  maxSpeed: number;
  avgSpeed: number;
  distance: number; // Session distance (local)
  lifetimeDistance: number; // Lifetime distance (blockchain)
  recordCount: number;
  checkpointCount: number;
  isTracking: boolean;
  blockchainConnected: boolean;
  pendingCheckpoints: number;
  teeEnabled: boolean;
  teeSessionActive: boolean;
  driveToEarnEnabled: boolean;
  pendingXP: number;
  walletBalance?: string;
  hasLowBalance?: boolean;
}

interface TrackingScreenProps {
  navigation?: any;
}

export default function TrackingScreen({ navigation }: TrackingScreenProps = {}) {
  const { user } = usePrivy();
  const { wallets, create } = useEmbeddedEthereumWallet();
  const account = getUserEmbeddedEthereumWallet(user);
  const authenticated = !!user;
  const router = useRouter();
  const [stats, setStats] = useState<TrackingStats>({
    currentSpeed: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    distance: 0,
    lifetimeDistance: 0,
    recordCount: 0,
    checkpointCount: 0,
    isTracking: false,
    blockchainConnected: false,
    pendingCheckpoints: 0,
    teeEnabled: false,
    teeSessionActive: false,
    driveToEarnEnabled: false,
    pendingXP: 0,
  });

  const [recentRecords, setRecentRecords] = useState<SpeedRecord[]>([]);
  const { getIdentityToken } = useIdentityToken();
  // null = not checked yet
  const [deviceRegistered, setDeviceRegistered] = useState<boolean | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isStartingDrive, setIsStartingDrive] = useState(false);
  
  // Cache for blockchain data to avoid excessive API calls
  const [blockchainDataCache, setBlockchainDataCache] = useState<{
    lifetimeDistance: number;
    lastFetch: number;
  }>({ lifetimeDistance: 0, lastFetch: 0 });

  useEffect(() => {
    // Initial update
    updateStats();
    
    // Update more frequently when tracking
    const interval = setInterval(() => {
      updateStats();
    }, 1000); // Update every second
    
    return () => clearInterval(interval);
  }, []);

  // Auto-create wallet for new users
  useEffect(() => {
    if (user && !account) {
      console.log('New user detected, creating wallet automatically...');
      create();
    }
  }, [user, account, create]);

  // Set user address in XP service when available
  useEffect(() => {
    if (account?.address) {
      const xpService = getXPService();
      xpService.setUserAddress(account.address);
      console.log('🎯 Set user address in XP service:', account.address);
    }
  }, [account?.address]);

  // Initialize wallet provider when user is authenticated
  useEffect(() => {
    const initializeWalletProvider = async () => {
      if (authenticated && account?.address && wallets.length > 0) {
        try {
          console.log('Initializing wallet provider for:', account.address);
          
          // Get the wallet provider from Privy embedded wallet
          const provider = await wallets[0].getProvider();
          if (provider) {
            const trackingService = getSpeedTrackingService();
            await trackingService.initializeWallet(provider);
            console.log('Wallet provider initialized successfully');
          } else {
            console.warn('No wallet provider available');
          }
        } catch (error) {
          console.error('Failed to initialize wallet provider:', error);
        }
      } else {
        console.log('User not authenticated or no wallet available');
      }
    };

    initializeWalletProvider();
  }, [authenticated, account?.address, wallets]);

  // Is this device's Secure Enclave key registered for this wallet?
  useEffect(() => {
    if (!account?.address) return;
    getDeviceIdentity(account.address as `0x${string}`)
      .then((identity) => setDeviceRegistered(identity !== null))
      .catch((error) => {
        console.error('Failed to read device identity:', error);
        setDeviceRegistered(false);
      });
  }, [account?.address]);

  const updateStats = async () => {
    try {
      const trackingService = getSpeedTrackingService();
      const blockchainService = getBlockchainService();

      // Get current stats from the main service
      const currentStats = await trackingService.getCurrentStats();
      const recentRecords = await trackingService.getRecentRecords(5); // Last 5 minutes
      
      setRecentRecords(recentRecords.slice(-10)); // Show last 10 records

      // Get blockchain status
      const isConnected = await blockchainService.checkConnection();
      const pendingCheckpoints = await blockchainService.getPendingCheckpoints();

      // Secure Enclave signing status
      let teeSessionActive = false;
      try {
        teeSessionActive = hasDriveSession();
      } catch {
        // Native module unavailable (e.g. Expo Go); keep defaults
      }

      // Get XP service status
      let driveToEarnEnabled = false;
      let pendingXP = 0;
      try {
        const xpService = getXPService();
        driveToEarnEnabled = await xpService.isDriveToEarnEnabled();
        pendingXP = xpService.getPendingXP();
      } catch {
        // XP service not available, keep defaults
      }

      // Get wallet balance info
      let walletBalance: string | undefined;
      let hasLowBalance = false;
      try {
        const balance = await blockchainService.getWalletBalance();
        const hasSufficientBalance = await blockchainService.hasSufficientBalance();
        if (balance) {
          walletBalance = balance.balanceInHBAR;
          hasLowBalance = !hasSufficientBalance;
        }
      } catch {
        // Balance check not available, keep defaults
      }

      // Get lifetime distance from blockchain (with caching to avoid rate limits)
      let lifetimeDistance = blockchainDataCache.lifetimeDistance;
      const now = Date.now();
      const CACHE_DURATION = 30000; // Cache for 30 seconds
      
      try {
        if (account?.address && isConnected && (now - blockchainDataCache.lastFetch > CACHE_DURATION)) {
          console.log('🔄 Fetching fresh blockchain stats (cache expired)...');
          const deviceStats = await blockchainService.getDeviceStats(account.address);
          lifetimeDistance = deviceStats.totalDistance;
          
          // Update cache
          setBlockchainDataCache({
            lifetimeDistance,
            lastFetch: now
          });
          
          console.log('🚗 Lifetime distance from blockchain:', lifetimeDistance, 'miles');
        } else if (blockchainDataCache.lastFetch > 0) {
          console.log('📦 Using cached blockchain distance:', lifetimeDistance, 'miles');
        }
      } catch (error) {
        console.log('Failed to get blockchain distance:', error);
        // Keep cached/default lifetime distance
      }

      setStats({
        currentSpeed: currentStats.currentSpeed,
        maxSpeed: currentStats.maxSpeed,
        avgSpeed: currentStats.avgSpeed,
        distance: currentStats.totalDistance,
        lifetimeDistance: lifetimeDistance,
        recordCount: currentStats.recordCount,
        checkpointCount: currentStats.checkpointCount,
        isTracking: trackingService.getTrackingStatus(),
        blockchainConnected: isConnected,
        pendingCheckpoints: pendingCheckpoints.length,
        teeEnabled: deviceRegistered === true,
        teeSessionActive,
        driveToEarnEnabled,
        pendingXP,
        walletBalance,
        hasLowBalance,
      });

    } catch (error) {
      console.error('Failed to update stats:', error);
    }
  };


  // One-time: create the enclave key, have Apple attest it, register it on chain.
  const registerThisDevice = async () => {
    if (isRegistering || !account?.address) return;
    if (!isDeviceSupported()) {
      Alert.alert('Not supported', 'This device cannot create a Secure Enclave key with App Attest.');
      return;
    }
    setIsRegistering(true);
    try {
      await registerDevice(account.address as `0x${string}`, getIdentityToken);
      setDeviceRegistered(true);
      Alert.alert('Device registered', 'This phone can now sign your speed checkpoints.');
    } catch (error) {
      console.error('Device registration failed:', error);
      Alert.alert('Registration failed', error instanceof Error ? error.message : String(error));
    } finally {
      setIsRegistering(false);
    }
  };

  // Face ID once to unlock the signing key for this drive, then start tracking.
  const startDrive = async () => {
    if (isStartingDrive) return;
    setIsStartingDrive(true);
    try {
      await beginDriveSession();
      const success = await getSpeedTrackingService().startTracking();
      if (!success) {
        endDriveSession();
        Alert.alert('Error', 'Failed to start tracking. Please check permissions.');
      }
      await updateStats();
    } catch (error) {
      console.error('Failed to start drive:', error);
      Alert.alert('Could not start drive', error instanceof Error ? error.message : String(error));
    } finally {
      setIsStartingDrive(false);
    }
  };

  const stopTracking = async () => {
    try {
      const trackingService = getSpeedTrackingService();
      
      // Show processing alert for drive-to-earn users
      if (stats.driveToEarnEnabled) {
        Alert.alert(
          'Processing Session',
          'Stopping tracking and processing XP rewards...',
          [],
          { cancelable: false }
        );
      }
      
      await trackingService.stopTracking();
      // Anchor anything still queued while the signing key is unlocked, then lock it.
      await getBlockchainService().retryPendingCheckpoints();
      endDriveSession();
      
      if (stats.driveToEarnEnabled) {
        Alert.alert(
          'Session Complete! 🎉',
          'Speed tracking stopped and XP rewards have been processed. Check your rewards screen for updates!',
          [
            { text: 'View Rewards', onPress: () => router.push('/rewards') },
            { text: 'OK', style: 'default' }
          ]
        );
      } else {
        Alert.alert('Success', 'Speed tracking stopped!');
      }
      
      await updateStats();
    } catch (error) {
      console.error('Failed to stop tracking:', error);
      Alert.alert('Error', 'Failed to stop tracking');
    }
  };





  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>ChainSpeed</Text>
          <Text style={styles.subtitle}>Safe driving tracker</Text>
        </View>

        {/* Main Speed Display */}
        <View style={styles.speedDisplay}>
          <Text style={styles.currentSpeedLabel}>
            {stats.currentSpeed === 0 ? 'Stationary' : 'Current Speed'}
          </Text>
          <Text style={[
            styles.currentSpeedValue,
            stats.currentSpeed === 0 && styles.stationarySpeed
          ]}>
            {stats.currentSpeed}
          </Text>
          <Text style={styles.currentSpeedUnit}>mph</Text>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statBoxLabel}>Max</Text>
            <Text style={styles.statBoxValue}>{stats.maxSpeed} mph</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statBoxLabel}>Average</Text>
            <Text style={styles.statBoxValue}>{stats.avgSpeed} mph</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statBoxLabel}>Session</Text>
            <Text style={styles.statBoxValue}>{stats.distance} mi</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statBoxLabel}>Lifetime</Text>
            <Text style={[styles.statBoxValue, styles.blockchainData]}>{stats.lifetimeDistance.toFixed(1)} mi</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statBoxLabel}>Checkpoints</Text>
            <Text style={styles.statBoxValue}>{stats.checkpointCount}</Text>
          </View>
        </View>

        {/* Drive Status */}
        <View style={styles.driveStatus}>
          <View style={styles.statusRow}>
            <View style={[styles.statusIndicator, stats.isTracking ? styles.connected : styles.disconnected]} />
            <Text style={styles.statusText}>
              {stats.isTracking ? 'Currently Tracking' : 'Not Tracking'}
            </Text>
          </View>
          
          {stats.driveToEarnEnabled && (
            <View style={styles.statusRow}>
              <View style={[styles.statusIndicator, styles.connected]} />
              <Text style={styles.statusText}>
                🎁 Drive-to-Earn Active
              </Text>
            </View>
          )}
          
          {stats.teeEnabled && stats.teeSessionActive && (
            <View style={styles.statusRow}>
              <View style={[styles.statusIndicator, styles.connected]} />
              <Text style={styles.statusText}>
                🔐 Secure Tracking Active
              </Text>
            </View>
          )}

          {/* {stats.walletBalance && (
            <View style={styles.statusRow}>
              <View style={[styles.statusIndicator, stats.hasLowBalance ? styles.warning : styles.connected]} />
              <Text style={styles.statusText}>
                💰 Balance: {stats.walletBalance}
              </Text>
            </View>
          )}

          {stats.hasLowBalance && (
            <View style={styles.warningContainer}>
              <Text style={styles.warningText}>
                ⚠️ Low HBAR balance! Get testnet funds from portal.hedera.com/faucet to submit checkpoints.
              </Text>
            </View>
          )} */}
        </View>

        {/* Control Buttons */}
        <View style={styles.buttonContainer}>
          {/* One-time device registration */}
          {deviceRegistered === false && !stats.isTracking && (
            <TouchableOpacity
              style={[styles.teeButton, isRegistering && styles.buttonDisabled]}
              onPress={registerThisDevice}
              disabled={isRegistering}
            >
              <Ionicons name="hardware-chip" size={20} color="white" style={{marginRight: 10}} />
              <Text style={styles.buttonText}>
                {isRegistering ? 'Registering device...' : 'Register this device'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Start a drive: Face ID unlocks the signing key */}
          {deviceRegistered === true && !stats.isTracking && (
            <TouchableOpacity
              style={[styles.startButton, isStartingDrive && styles.buttonDisabled]}
              onPress={startDrive}
              disabled={isStartingDrive}
            >
              <Ionicons name="finger-print" size={20} color="white" style={{marginRight: 10}} />
              <Text style={styles.buttonText}>{isStartingDrive ? 'Starting...' : 'Start Drive (Face ID)'}</Text>
            </TouchableOpacity>
          )}

          {/* Step 4: Stop Tracking */}
          {stats.isTracking && (
            <TouchableOpacity style={styles.stopButton} onPress={stopTracking}>
              <Ionicons name="stop" size={20} color="white" style={{marginRight: 10}} />
              <Text style={styles.buttonText}>Stop Tracking</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Quick Tips */}
        {!stats.isTracking && (
          <View style={styles.tipsSection}>
            <Text style={styles.tipTitle}>💡 Quick Tips</Text>
            <Text style={styles.tipText}>• Register this device once: Apple attests its signing key</Text>
            <Text style={styles.tipText}>• Each drive starts with one Face ID check</Text>
            <Text style={styles.tipText}>• Drive safely to earn rewards with secure tracking</Text>
          </View>
        )}

        {/* Recent Activity */}
        {stats.isTracking && recentRecords.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {recentRecords.slice(-3).map((record, index) => (
              <View key={index} style={styles.recordItem}>
                <Text style={styles.recordTime}>
                  {new Date(record.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={styles.recordSpeed}>{record.speed.toFixed(1)} mph</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 5,
  },
  speedDisplay: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 30,
    marginBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  currentSpeedLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  currentSpeedValue: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#333',
  },
  currentSpeedUnit: {
    fontSize: 18,
    color: '#666',
    marginTop: -5,
  },
  stationarySpeed: {
    color: '#999',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statBox: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    width: '48%',
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  statBoxLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 5,
  },
  statBoxValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  blockchainData: {
    color: '#4CAF50', // Green color to indicate blockchain data
  },
  buttonContainer: {
    marginBottom: 20,
  },
  startButton: {
    backgroundColor: '#4CAF50',
    padding: 20,
    borderRadius: 30,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  stopButton: {
    backgroundColor: '#f44336',
    padding: 20,
    borderRadius: 30,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  teeButton: {
    backgroundColor: '#9C27B0',
    padding: 15,
    borderRadius: 25,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  resetButton: {
    backgroundColor: '#FF9800',
    padding: 15,
    borderRadius: 25,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  actionButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#999',
    marginBottom: 10,
  },
  recordItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  recordTime: {
    flex: 1,
    fontSize: 14,
    color: '#666',
  },
  recordSpeed: {
    flex: 1,
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#333',
  },
  recordAccuracy: {
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
    color: '#999',
  },
  tipsSection: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  tipText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
    lineHeight: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  warningContainer: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
  },
  warningText: {
    fontSize: 12,
    color: '#856404',
    lineHeight: 16,
  },
  securePrompt: {
    backgroundColor: '#f0f8ff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#9C27B0',
  },
  securePromptText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  teeSecondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#9C27B0',
    padding: 12,
    borderRadius: 20,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teeSecondaryButtonText: {
    color: '#9C27B0',
    fontSize: 14,
    fontWeight: '500',
  },
  authenticateButton: {
    backgroundColor: '#2196F3',
    padding: 20,
    borderRadius: 30,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  checkpointItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  checkpointTime: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  checkpointStats: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  checkpointRoot: {
    fontSize: 12,
    color: '#999',
    fontFamily: 'monospace',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  driveStatus: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  connected: {
    backgroundColor: '#4CAF50',
  },
  disconnected: {
    backgroundColor: '#f44336',
  },
  warning: {
    backgroundColor: '#FF9800',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  pendingText: {
    fontSize: 12,
    color: '#FF9800',
    fontStyle: 'italic',
  },
  xpBadge: {
    backgroundColor: '#4CAF50',
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  rewardsButton: {
    backgroundColor: '#FF6B35',
    padding: 15,
    borderRadius: 25,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
    position: 'relative',
  },
  xpBadgeButton: {
    position: 'absolute',
    top: -8,
    right: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  xpBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
});