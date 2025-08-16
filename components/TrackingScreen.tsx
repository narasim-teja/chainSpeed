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
import { getSpeedTrackingService } from '../services/SpeedTrackingService';
import { SpeedRecord } from '../services/LocationService';
import { CheckpointData } from '../services/MerkleService';

interface TrackingStats {
  currentSpeed: number;
  maxSpeed: number;
  avgSpeed: number;
  distance: number;
  recordCount: number;
  checkpointCount: number;
  isTracking: boolean;
}

export default function TrackingScreen() {
  const [stats, setStats] = useState<TrackingStats>({
    currentSpeed: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    distance: 0,
    recordCount: 0,
    checkpointCount: 0,
    isTracking: false,
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

  const updateStats = async () => {
    try {
      const trackingService = getSpeedTrackingService();

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

      setStats({
        currentSpeed: currentStats.currentSpeed,
        maxSpeed: currentStats.maxSpeed,
        avgSpeed: currentStats.avgSpeed,
        distance: currentStats.totalDistance,
        recordCount: currentStats.recordCount,
        checkpointCount: currentStats.checkpointCount,
        isTracking: trackingService.getTrackingStatus(),
      });

    } catch (error) {
      console.error('Failed to update stats:', error);
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

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

  const createManualCheckpoint = async () => {
    try {
      const trackingService = getSpeedTrackingService();
      const success = await trackingService.createManualCheckpoint();
      
      if (success) {
        Alert.alert('Success', 'Checkpoint created successfully!');
        await updateStats();
      } else {
        Alert.alert('Info', 'No records available for checkpoint');
      }
    } catch (error) {
      console.error('Failed to create checkpoint:', error);
      Alert.alert('Error', 'Failed to create checkpoint');
    }
  };

  const testAttestation = async () => {
    try {
      const trackingService = getSpeedTrackingService();
      const validation = await trackingService.validateDataIntegrity();
      
      if (validation.isValid) {
        Alert.alert('Data Integrity', 'All data signatures are valid!');
      } else {
        Alert.alert(
          'Data Integrity Issues',
          `Found ${validation.issues.length} issues:\n` +
          validation.issues.slice(0, 3).join('\n') +
          (validation.issues.length > 3 ? '\n...' : '')
        );
      }
    } catch (error) {
      console.error('Failed to validate data:', error);
      Alert.alert('Error', 'Failed to validate data integrity');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>ChainSpeed Tracking</Text>

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
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
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
});