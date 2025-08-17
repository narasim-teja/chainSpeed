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
import { usePrivy, useEmbeddedEthereumWallet, getUserEmbeddedEthereumWallet } from '@privy-io/expo';
import { getSpeedTrackingService } from '../services/SpeedTrackingService';
import { SpeedRecord } from '../services/LocationService';
import { CheckpointData } from '../services/MerkleService';
import { getBlockchainService } from '../services/BlockchainService';

interface TrackingStats {
  currentSpeed: number;
  maxSpeed: number;
  avgSpeed: number;
  distance: number;
  recordCount: number;
  checkpointCount: number;
  isTracking: boolean;
  blockchainConnected: boolean;
  pendingCheckpoints: number;
  teeEnabled: boolean;
  teeSessionActive: boolean;
}

interface TrackingScreenProps {
  navigation?: any;
}

export default function TrackingScreen({ navigation }: TrackingScreenProps) {
  const { user } = usePrivy();
  const { wallets, create } = useEmbeddedEthereumWallet();
  const account = getUserEmbeddedEthereumWallet(user);
  const authenticated = !!user;
  const [stats, setStats] = useState<TrackingStats>({
    currentSpeed: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    distance: 0,
    recordCount: 0,
    checkpointCount: 0,
    isTracking: false,
    blockchainConnected: false,
    pendingCheckpoints: 0,
    teeEnabled: false,
    teeSessionActive: false,
  });

  const [recentRecords, setRecentRecords] = useState<SpeedRecord[]>([]);
  const [recentCheckpoints, setRecentCheckpoints] = useState<CheckpointData[]>([]);

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

  const updateStats = async () => {
    try {
      const trackingService = getSpeedTrackingService();
      const blockchainService = getBlockchainService();

      // Get current stats from the main service
      const currentStats = await trackingService.getCurrentStats();
      const recentRecords = await trackingService.getRecentRecords(5); // Last 5 minutes
      
      setRecentRecords(recentRecords.slice(-10)); // Show last 10 records
      
      // Also get recent checkpoints
      const { getMerkleService } = await import('../services/MerkleService');
      const merkleService = getMerkleService();
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const checkpoints = await merkleService.getCheckpoints(todayStart);
      setRecentCheckpoints(checkpoints.slice(-5)); // Show last 5 checkpoints

      // Get blockchain status
      const isConnected = await blockchainService.checkConnection();
      const pendingCheckpoints = await blockchainService.getPendingCheckpoints();

      // Get TEE status
      let teeEnabled = false;
      let teeSessionActive = false;
      try {
        const { getTEECryptoService } = await import('../services/TEECryptoService');
        const teeService = getTEECryptoService();
        const teeStatus = await teeService.getTEEStatus();
        teeEnabled = teeStatus.keyGenerated && teeStatus.hardwareBacked;
        teeSessionActive = teeStatus.sessionActive;
      } catch {
        // TEE not available, keep defaults
      }

      setStats({
        currentSpeed: currentStats.currentSpeed,
        maxSpeed: currentStats.maxSpeed,
        avgSpeed: currentStats.avgSpeed,
        distance: currentStats.totalDistance,
        recordCount: currentStats.recordCount,
        checkpointCount: currentStats.checkpointCount,
        isTracking: trackingService.getTrackingStatus(),
        blockchainConnected: isConnected,
        pendingCheckpoints: pendingCheckpoints.length,
        teeEnabled,
        teeSessionActive,
      });

    } catch (error) {
      console.error('Failed to update stats:', error);
    }
  };


  const startTracking = async () => {
    try {
      const trackingService = getSpeedTrackingService();
      const success = await trackingService.startTracking();
      
      if (success) {
        Alert.alert('Success', 'Speed tracking started!');
        await updateStats();
      } else {
        Alert.alert('Error', 'Failed to start tracking. Please check permissions.');
      }
    } catch (error) {
      console.error('Failed to start tracking:', error);
      Alert.alert('Error', 'Failed to start tracking');
    }
  };

  const stopTracking = async () => {
    try {
      const trackingService = getSpeedTrackingService();
      await trackingService.stopTracking();
      
      Alert.alert('Success', 'Speed tracking stopped!');
      await updateStats();
    } catch (error) {
      console.error('Failed to stop tracking:', error);
      Alert.alert('Error', 'Failed to stop tracking');
    }
  };

  const authenticateTEE = async () => {
    try {
      const { getTEECryptoService } = await import('../services/TEECryptoService');
      const teeService = getTEECryptoService();
      
      await teeService.authenticateSession();
      Alert.alert('Success', 'TEE session authenticated! Speed tracking is now hardware-secured.');
      await updateStats();
    } catch (error) {
      console.error('TEE authentication failed:', error);
      Alert.alert('Authentication Failed', 'Could not authenticate with Secure Enclave. Please try again.');
    }
  };

  const resetTEE = async () => {
    try {
      const { getTEECryptoService } = await import('../services/TEECryptoService');
      const teeService = getTEECryptoService();
      
      await teeService.resetTEE();
      await teeService.initialize();
      Alert.alert('Success', 'TEE reset and reinitialized! Try authenticating again.');
      await updateStats();
    } catch (error) {
      console.error('TEE reset failed:', error);
      Alert.alert('Reset Failed', 'Could not reset TEE state: ' + (error instanceof Error ? error.message : String(error)));
    }
  };


  const openProfile = () => {
    if (navigation) {
      navigation.push('/profile');
    } else {
      // For now, show an alert with basic info
      Alert.alert(
        'Profile',
        'Wallet address and settings will be shown here. Navigate to Profile screen to see full details.'
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header with title and settings */}
        <View style={styles.header}>
          <Text style={styles.title}>ChainSpeed</Text>
          <TouchableOpacity style={styles.settingsButton} onPress={openProfile}>
            <Ionicons name="person-circle-outline" size={28} color="#333" />
          </TouchableOpacity>
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
            <Text style={styles.statBoxLabel}>Distance</Text>
            <Text style={styles.statBoxValue}>{stats.distance} mi</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statBoxLabel}>Checkpoints</Text>
            <Text style={styles.statBoxValue}>{stats.checkpointCount}</Text>
          </View>
        </View>

        {/* Blockchain Status */}
        <View style={styles.blockchainStatus}>
          <View style={styles.statusRow}>
            <View style={[styles.statusIndicator, stats.blockchainConnected ? styles.connected : styles.disconnected]} />
            <Text style={styles.statusText}>
                                Hedera Blockchain {stats.blockchainConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          
          <View style={styles.statusRow}>
            <View style={[styles.statusIndicator, stats.teeEnabled ? styles.connected : styles.disconnected]} />
            <Text style={styles.statusText}>
              🔐 TEE Secure Enclave {stats.teeEnabled ? 'Active' : 'Unavailable'}
            </Text>
          </View>
          
          {stats.teeEnabled && (
            <View style={styles.statusRow}>
              <View style={[styles.statusIndicator, stats.teeSessionActive ? styles.connected : styles.warning]} />
              <Text style={styles.statusText}>
                Session {stats.teeSessionActive ? 'Authenticated' : 'Requires Auth'}
              </Text>
            </View>
          )}
          
          {stats.pendingCheckpoints > 0 && (
            <Text style={styles.pendingText}>
              {stats.pendingCheckpoints} checkpoints pending blockchain submission
            </Text>
          )}
        </View>

        {/* Control Buttons */}
        <View style={styles.buttonContainer}>
          {!stats.isTracking ? (
            <TouchableOpacity style={styles.startButton} onPress={startTracking}>
              <Text style={styles.buttonText}>Start Tracking</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.stopButton} onPress={stopTracking}>
              <Text style={styles.buttonText}>Stop Tracking</Text>
            </TouchableOpacity>
          )}
          
          {stats.teeEnabled && !stats.teeSessionActive && (
            <TouchableOpacity style={styles.teeButton} onPress={authenticateTEE}>
              <Ionicons name="finger-print" size={20} color="white" />
              <Text style={styles.buttonText}>Authenticate TEE</Text>
            </TouchableOpacity>
          )}
          
          {!stats.teeEnabled && (
            <TouchableOpacity style={styles.resetButton} onPress={resetTEE}>
              <Ionicons name="refresh" size={20} color="white" />
              <Text style={styles.buttonText}>Reset & Retry TEE</Text>
            </TouchableOpacity>
          )}

        </View>

        {/* Recent Records */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Speed Records</Text>
          {recentRecords.length > 0 ? (
            recentRecords.slice(-5).map((record, index) => (
              <View key={index} style={styles.recordItem}>
                <Text style={styles.recordTime}>
                  {new Date(record.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={styles.recordSpeed}>{record.speed.toFixed(1)} mph</Text>
                <Text style={styles.recordAccuracy}>±{record.accuracy.toFixed(0)}m</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No records yet</Text>
          )}
        </View>

        {/* Recent Checkpoints */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Automatic Checkpoints</Text>
          <Text style={styles.sectionSubtitle}>Created every 30 seconds while driving</Text>
          {recentCheckpoints.length > 0 ? (
            recentCheckpoints.slice(-3).map((checkpoint, index) => (
              <View key={index} style={styles.checkpointItem}>
                <Text style={styles.checkpointTime}>
                  {new Date(checkpoint.endTime).toLocaleTimeString()}
                </Text>
                <Text style={styles.checkpointStats}>
                  {checkpoint.recordCount} records, {checkpoint.avgSpeed} mph avg
                </Text>
                <Text style={styles.checkpointRoot}>
                  Root: {checkpoint.merkleRoot.substring(0, 8)}...
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No checkpoints yet</Text>
          )}
        </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  settingsButton: {
    padding: 8,
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
  buttonContainer: {
    marginBottom: 20,
  },
  startButton: {
    backgroundColor: '#4CAF50',
    padding: 20,
    borderRadius: 30,
    marginBottom: 10,
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
  blockchainStatus: {
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
});