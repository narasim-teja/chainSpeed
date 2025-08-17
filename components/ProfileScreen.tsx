import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ScrollView,
  Modal,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { usePrivy, useEmbeddedEthereumWallet, getUserEmbeddedEthereumWallet } from '@privy-io/expo';

import { getBlockchainService } from '../services/BlockchainService';
import { getSpeedTrackingService } from '../services/SpeedTrackingService';
import { getMerkleService } from '../services/MerkleService';
import { CONTRACT_CONFIG, CURRENT_CHAIN_CONFIG } from '../constants/Blockchain';

interface ProfileScreenProps {
  navigation?: any;
}

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { user, logout } = usePrivy();
  const { create } = useEmbeddedEthereumWallet();
  const account = getUserEmbeddedEthereumWallet(user);
  const authenticated = !!user;
  const [pendingCheckpoints, setPendingCheckpoints] = useState(0);
  
  // Speed Proof Query states
  const [showProofModal, setShowProofModal] = useState(false);
  const [availableRecords, setAvailableRecords] = useState<any[]>([]);
  const [availableCheckpoints, setAvailableCheckpoints] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  
  // Date/Time picker states
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [pickerType, setPickerType] = useState<'start' | 'end'>('start');
  const [tempDate, setTempDate] = useState(new Date());
  
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);
  const [proofResult, setProofResult] = useState<any>(null);
  const [pendingCheckpointsCount, setPendingCheckpointsCount] = useState(0);
  const [isRetryingCheckpoints, setIsRetryingCheckpoints] = useState(false);
  
  // ScrollView ref for auto-scrolling to results
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadProfileData();
  }, []);

  // Auto-create wallet for new users
  useEffect(() => {
    if (user && !account) {
      console.log('New user detected, creating wallet automatically...');
      create();
    }
  }, [user, account, create]);

  const loadProfileData = async () => {
    const blockchainService = getBlockchainService();
    const pending = await blockchainService.getPendingCheckpoints();
    
    setPendingCheckpoints(pending.length);
    setPendingCheckpointsCount(pending.length);
  };

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied!', `${label} copied to clipboard`);
  };

  const submitPendingCheckpoints = async () => {
    if (!authenticated) {
      Alert.alert('Error', 'Please connect your wallet first');
      return;
    }

    Alert.alert(
      'Submit Checkpoints',
      `Submit ${pendingCheckpoints} pending checkpoints to the blockchain?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Submit', 
          onPress: async () => {
            try {
              const blockchainService = getBlockchainService();
              const result = await blockchainService.retryPendingCheckpoints();
              
              if (result.submitted > 0) {
                Alert.alert(
                  'Success!', 
                  `${result.submitted} checkpoints submitted successfully!${result.failed > 0 ? ` ${result.failed} failed.` : ''}`
                );
                await loadProfileData(); // Refresh the data
              } else if (result.failed > 0) {
                Alert.alert('Failed', `All ${result.failed} checkpoint submissions failed. Check your wallet balance.`);
              } else {
                Alert.alert('Info', 'No checkpoints were submitted. Make sure your wallet has testnet HBAR.');
              }
            } catch (error) {
              console.error('Failed to submit checkpoints:', error);
              Alert.alert('Error', 'Failed to submit checkpoints. Please try again.');
            }
          }
        }
      ]
    );
  };

  const getWalletAddress = () => {
    // Get wallet address from Privy embedded wallet
    if (account?.address) {
      return account.address;
    }
    return 'No wallet connected';
  };

  const openDateTimePicker = (type: 'start' | 'end', mode: 'date' | 'time') => {
    const currentDate = type === 'start' ? startDate : endDate;
    setTempDate(new Date(currentDate));
    setPickerType(type);
    setPickerMode(mode);
    setShowDateTimePicker(true);
  };

  const handleDateTimeChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) {
      setTempDate(selectedDate);
    }
  };

  const confirmDateTimeSelection = () => {
    if (pickerType === 'start') {
      setStartDate(new Date(tempDate));
    } else {
      setEndDate(new Date(tempDate));
    }
    setShowDateTimePicker(false);
  };

  const cancelDateTimeSelection = () => {
    setShowDateTimePicker(false);
  };

  const loadAvailableData = async () => {
    try {
      setIsLoadingData(true);
      
      const speedTrackingService = getSpeedTrackingService();
      const blockchainService = getBlockchainService();
      
      // Get records from the last 30 days
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const records = await speedTrackingService.exportDataForTimeRange(thirtyDaysAgo, Date.now());
      
      if (records) {
        setAvailableRecords(records.records || []);
        
        // Set default date range to cover available data
        if (records.records && records.records.length > 0) {
          const firstRecord = records.records[0];
          const lastRecord = records.records[records.records.length - 1];
          setStartDate(new Date(firstRecord.timestamp));
          setEndDate(new Date(lastRecord.timestamp));
        }
      }
      
      // Get blockchain checkpoints for the device
      const deviceAddress = getWalletAddress();
      if (deviceAddress && deviceAddress !== 'No wallet connected') {
        const blockchainCheckpoints = await blockchainService.getDeviceCheckpointsInRange(
          deviceAddress,
          thirtyDaysAgo,
          Date.now()
        );
        
        setAvailableCheckpoints(blockchainCheckpoints);
        
        console.log('Loaded blockchain checkpoints:', {
          count: blockchainCheckpoints.length,
          device: deviceAddress
        });
      }
      
      console.log('Loaded available data:', {
        records: records?.records?.length || 0,
        blockchainCheckpoints: availableCheckpoints.length,
        dateRange: records && records.records && records.records.length > 0 ? {
          from: new Date(records.records[0]!.timestamp).toISOString(),
          to: new Date(records.records[records.records.length - 1]!.timestamp).toISOString()
        } : 'No data'
      });
      
    } catch (error) {
      console.error('Failed to load available data:', error);
      Alert.alert('Error', 'Failed to load available data');
    } finally {
      setIsLoadingData(false);
    }
  };

  const retryPendingCheckpoints = async () => {
    if (!authenticated) {
      Alert.alert('Error', 'Please connect your wallet first');
      return false;
    }

    setIsRetryingCheckpoints(true);
    try {
      const blockchainService = getBlockchainService();
      const result = await blockchainService.retryPendingCheckpoints();
      
      if (result.submitted > 0) {
        console.log(`Successfully submitted ${result.submitted} pending checkpoints`);
        await loadProfileData(); // Refresh the data
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to retry pending checkpoints:', error);
      return false;
    } finally {
      setIsRetryingCheckpoints(false);
    }
  };

  const generateSpeedProof = async () => {
    try {
      setIsGeneratingProof(true);
      setProofResult(null);

      // First, try to submit any pending checkpoints to improve verification rate
      console.log('Checking pending checkpoints before proof generation...');
      const blockchainServiceForPending = getBlockchainService();
      const actualPendingCheckpoints = await blockchainServiceForPending.getPendingCheckpoints();
      console.log('Actual pending checkpoints found:', actualPendingCheckpoints.length);
      
      if (actualPendingCheckpoints.length > 0) {
        console.log(`Attempting to submit ${actualPendingCheckpoints.length} pending checkpoints before proof generation...`);
        const retrySuccess = await retryPendingCheckpoints();
        if (retrySuccess) {
          console.log('Successfully submitted pending checkpoints, this will improve proof verification');
        }
      } else {
        console.log('No pending checkpoints found in storage - checkpoints may have been created but never stored as pending');
      }

      const startTime = startDate.getTime();
      const endTime = endDate.getTime();

      if (isNaN(startTime) || isNaN(endTime)) {
        Alert.alert('Error', 'Invalid date format. Use YYYY-MM-DD HH:MM');
        return;
      }

      if (startTime >= endTime) {
        Alert.alert('Error', 'End time must be after start time');
        return;
      }

      console.log('Generating proof for timeframe:', {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString()
      });

      const speedTrackingService = getSpeedTrackingService();
      const blockchainService = getBlockchainService();

      // 1. Get local records for statistics
      const exportData = await speedTrackingService.exportDataForTimeRange(startTime, endTime);
      
      if (!exportData || exportData.records.length === 0) {
        Alert.alert('No Data', 'No speed records found for the specified timeframe');
        return;
      }

      // 2. Get checkpoints directly from blockchain for the device and timeframe
      const deviceAddress = getWalletAddress();
      console.log('Fetching blockchain checkpoints for device:', deviceAddress);
      
      const blockchainCheckpoints = await blockchainService.getDeviceCheckpointsInRange(
        deviceAddress,
        startTime,
        endTime
      );

      if (blockchainCheckpoints.length === 0) {
        Alert.alert('No Blockchain Data', 'No checkpoints found on blockchain for this timeframe. Make sure you have submitted checkpoints to the blockchain.');
        return;
      }

      // 3. Create verification results from blockchain checkpoints
      const verificationResults = [];
      
      for (const blockchainCheckpoint of blockchainCheckpoints) {
        try {
          // Generate proof document for each blockchain checkpoint
          const proofDoc = await blockchainService.generateProofDocument(blockchainCheckpoint.merkleRoot);
          
          verificationResults.push({
            checkpoint: {
              merkleRoot: blockchainCheckpoint.merkleRoot,
              startTime: blockchainCheckpoint.startTime,
              endTime: blockchainCheckpoint.endTime,
              avgSpeed: blockchainCheckpoint.avgSpeed,
              maxSpeed: blockchainCheckpoint.maxSpeed,
              minSpeed: blockchainCheckpoint.minSpeed,
              recordCount: blockchainCheckpoint.recordCount
            },
            blockchainCheckpoint,
            proofDocument: proofDoc,
            isValid: proofDoc.isValid,
            timeRange: {
              start: new Date(blockchainCheckpoint.startTime),
              end: new Date(blockchainCheckpoint.endTime)
            }
          });
        } catch (error) {
          console.error('Error generating proof for checkpoint:', error);
          verificationResults.push({
            checkpoint: blockchainCheckpoint,
            blockchainCheckpoint,
            isValid: false,
            error: error instanceof Error ? error.message : 'Proof generation failed'
          });
        }
      }

      // 4. Calculate aggregate statistics from local records
      const allRecords = exportData.records;
      const speeds = allRecords.map(r => r.speed);
      const avgSpeed = speeds.length > 0 ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : 0;
      const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
      const minSpeed = speeds.length > 0 ? Math.min(...speeds) : 0;

      // Calculate total distance
      let totalDistance = 0;
      for (let i = 1; i < allRecords.length; i++) {
        const prev = allRecords[i - 1];
        const curr = allRecords[i];
        const R = 3959; // Earth's radius in miles
        const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
        const dLon = (curr.longitude - prev.longitude) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        totalDistance += R * c;
      }

      const proofSummary = {
        timeframe: {
          start: new Date(startTime),
          end: new Date(endTime),
          duration: (endTime - startTime) / 1000 / 60 // minutes
        },
        statistics: {
          avgSpeed: Math.round(avgSpeed * 100) / 100,
          maxSpeed: Math.round(maxSpeed * 100) / 100,
          minSpeed: Math.round(minSpeed * 100) / 100,
          totalDistance: Math.round(totalDistance * 100) / 100,
          recordCount: allRecords.length
        },
        verification: {
          checkpointsFound: verificationResults.length,
          checkpointsVerified: verificationResults.filter(r => r.isValid).length,
          blockchainVerified: verificationResults.every(r => r.isValid),
          contractAddress: CONTRACT_CONFIG.address,
          network: CURRENT_CHAIN_CONFIG.name
        },
        checkpoints: verificationResults,
        deviceAttestation: exportData.attestation,
        generatedAt: new Date().toISOString(),
        walletAddress: getWalletAddress()
      };

      setProofResult(proofSummary);
      console.log('Proof generated successfully:', proofSummary);
      console.log('UI State after setting proofResult:', {
        proofResultExists: !!proofSummary,
        blockchainVerified: proofSummary.verification.blockchainVerified,
        checkpointsFound: proofSummary.verification.checkpointsFound,
        recordCount: proofSummary.statistics.recordCount
      });
      
      // Show success alert
      Alert.alert(
        'Proof Generated! ✅', 
        `Successfully generated blockchain-verified speed proof with ${proofSummary.verification.checkpointsVerified} checkpoints directly from blockchain. Scroll down to view results.`,
        [{ text: 'View Proof', onPress: () => {
          setTimeout(() => {
            if (scrollViewRef.current) {
              scrollViewRef.current.scrollToEnd({ animated: true });
            }
          }, 100);
        }}]
      );

    } catch (error) {
      console.error('Failed to generate proof:', error);
      Alert.alert('Error', `Failed to generate proof: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsGeneratingProof(false);
    }
  };



  return (
    <SafeAreaView style={styles.container}>
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>Generate driving proofs</Text>
        </View>

        {/* Wallet Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Wallet</Text>
          
          <TouchableOpacity 
            style={styles.walletCard}
            onPress={() => copyToClipboard(getWalletAddress(), 'Wallet address')}
          >
            <View style={styles.walletInfo}>
              <Ionicons name="wallet" size={24} color="#4CAF50" />
              <View style={styles.walletDetails}>
                <Text style={styles.walletStatus}>
                  {authenticated ? 'Connected' : 'Disconnected'}
                </Text>
                <Text style={styles.walletAddress} numberOfLines={1}>
                  {getWalletAddress()}
                </Text>
              </View>
            </View>
            <Ionicons name="copy-outline" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        {/* Speed Proof Query */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { marginBottom: 15 }]}>Legal Speed Verification</Text>
          <Text style={styles.description}>
            Generate blockchain-verified speed proofs for legal defense against speeding tickets.
          </Text>

          <TouchableOpacity 
            style={styles.proofButton} 
            onPress={() => {
              setShowProofModal(true);
              loadAvailableData();
            }}
          >
            <Ionicons name="document-text-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Generate Speed Proof</Text>
          </TouchableOpacity>

          {/* Manual Delete Checkpoints */}
          {/* <TouchableOpacity 
            style={[styles.dangerButton, { marginTop: 10 }]}
            onPress={async () => {
              Alert.alert(
                'Clear All Checkpoints',
                'This will delete ALL locally stored checkpoints and pending submissions. This action cannot be undone. Use this if checkpoints are stuck or causing issues.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { 
                    text: 'Clear All', 
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const blockchainService = getBlockchainService();
                        const merkleService = getMerkleService();
                        
                        // Clear all local checkpoints
                        await merkleService.clearAllCheckpoints();
                        
                        // Clear pending checkpoints
                        await blockchainService.clearAllPendingCheckpoints();
                        
                        Alert.alert('Success', 'All checkpoints cleared successfully!');
                        await loadProfileData();
                        
                      } catch (error) {
                        console.error('Failed to clear checkpoints:', error);
                        Alert.alert('Error', 'Failed to clear checkpoints: ' + (error instanceof Error ? error.message : String(error)));
                      }
                    }
                  }
                ]
              );
            }}
          >
            <Ionicons name="trash-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Clear All Checkpoints</Text>
          </TouchableOpacity> */}

          {/* Manual retry for missing checkpoints */}
          {/* <TouchableOpacity 
            style={[styles.warningButton, { marginTop: 10 }]}
            onPress={async () => {
              Alert.alert(
                'Retry Failed Submissions',
                'This will attempt to submit up to 5 locally stored checkpoints that failed to reach the blockchain. Rate limited to avoid API issues.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { 
                    text: 'Retry 5', 
                    onPress: async () => {
                      try {
                        const blockchainService = getBlockchainService();
                        const merkleService = getMerkleService();
                        
                        // Get all local checkpoints
                        const allLocalCheckpoints = await merkleService.getCheckpoints();
                        console.log(`Found ${allLocalCheckpoints.length} local checkpoints`);
                        
                        // Rate limiting: only process first 5 checkpoints to avoid rate limits
                        const maxRetries = 3;
                        const checkpointsToRetry = allLocalCheckpoints.slice(0, maxRetries);
                        
                        let retryCount = 0;
                        let successCount = 0;
                        let rateLimitHit = false;
                        
                        for (const localCheckpoint of checkpointsToRetry) {
                          try {
                            // Add delay between requests to avoid rate limiting
                            if (retryCount > 0) {
                              console.log('⏳ Waiting 2 seconds to avoid rate limiting...');
                              await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                            
                            // Check if this checkpoint exists on blockchain
                            const blockchainCheckpoint = await blockchainService.getCheckpointByRoot(localCheckpoint.merkleRoot);
                            
                            if (!blockchainCheckpoint) {
                              // Checkpoint not found on blockchain, try to submit it
                              console.log(`Retrying submission for checkpoint: ${localCheckpoint.merkleRoot.substring(0, 8)}...`);
                              const txHash = await blockchainService.submitCheckpoint(localCheckpoint);
                              
                              if (txHash && !txHash.startsWith('pending-')) {
                                successCount++;
                                console.log(`Successfully submitted checkpoint: ${txHash.substring(0, 8)}...`);
                              }
                              retryCount++;
                            }
                          } catch (error: any) {
                            console.error('Failed to retry checkpoint submission:', error);
                            
                            // Check if we hit rate limiting
                            if (error.message && (error.message.includes('rate limit') || error.message.includes('too many requests'))) {
                              rateLimitHit = true;
                              console.warn('⚠️ Rate limit hit, stopping retries');
                              break;
                            }
                          }
                        }
                        
                        let message = `Attempted to retry ${retryCount} checkpoints. ${successCount} were successfully submitted.`;
                        
                        if (rateLimitHit) {
                          message += '\n\n⚠️ Rate limit reached. Wait a few minutes before trying again.';
                        }
                        
                        if (allLocalCheckpoints.length > maxRetries) {
                          message += `\n\n💡 ${allLocalCheckpoints.length - maxRetries} more checkpoints available. Run again to retry more.`;
                        }
                        
                        Alert.alert(
                          'Retry Complete',
                          message,
                          [{ text: 'OK', onPress: () => loadProfileData() }]
                        );
                        
                      } catch (error) {
                        console.error('Failed to retry submissions:', error);
                        Alert.alert('Error', 'Failed to retry submissions. Please try again.');
                      }
                    }
                  }
                ]
              );
            }}
          >
            <Ionicons name="refresh-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Retry 5 Checkpoints</Text>
          </TouchableOpacity> */}
        </View>

        {/* Actions */}
        <View style={styles.buttonContainer}>


          {pendingCheckpointsCount > 0 && (
            <>
              <TouchableOpacity 
                style={[styles.actionButton, isRetryingCheckpoints && styles.disabledButton]} 
                onPress={submitPendingCheckpoints}
                disabled={isRetryingCheckpoints}
              >
                {isRetryingCheckpoints ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={20} color="white" />
                )}
                <Text style={styles.buttonText}>
                  {isRetryingCheckpoints ? 'Submitting...' : `Submit ${pendingCheckpointsCount} Pending Checkpoints`}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.warningButton} 
                onPress={async () => {
                  Alert.alert(
                    'Clear Pending Checkpoints',
                    'This will delete all pending checkpoints. Are you sure?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Clear', 
                        style: 'destructive',
                        onPress: async () => {
                          const blockchainService = getBlockchainService();
                          await blockchainService.clearPendingCheckpoints();
                          await loadProfileData();
                          Alert.alert('Success', 'Pending checkpoints cleared');
                        }
                      }
                    ]
                  );
                }}
              >
                <Ionicons name="trash-outline" size={20} color="white" />
                <Text style={styles.buttonText}>Clear Pending (Debug)</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity 
            style={styles.dangerButton} 
            onPress={async () => {
              Alert.alert(
                'Logout',
                'Are you sure you want to logout? This will clear your session and return you to the login screen.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { 
                    text: 'Logout', 
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        console.log('🚪 Logging out user...');
                        
                        // Clear any local session data
                        console.log('🧹 Clearing local session data...');
                        
                        // End TEE session if active
                        try {
                          const { getTEECryptoService } = await import('../services/TEECryptoService');
                          const teeService = getTEECryptoService();
                          await teeService.endSession();
                          console.log('🔒 TEE session ended');
                        } catch (teeError) {
                          console.log('TEE session cleanup not needed or failed:', teeError);
                        }
                        
                        // Logout from Privy (this will redirect to login screen)
                        await logout();
                        
                        console.log('✅ Logout completed, redirecting to homepage...');
                        
                      } catch (error) {
                        console.error('❌ Logout failed:', error);
                        Alert.alert('Logout Failed', 'There was an error logging out. Please try again.');
                      }
                    }
                  }
                ]
              );
            }}
          >
            <Ionicons name="log-out-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Speed Proof Query Modal */}
      <Modal
        visible={showProofModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowProofModal(false)}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Generate Speed Proof</Text>

        </View>

                    <ScrollView style={styles.modalContent}>
            <Text style={styles.modalDescription}>
              Select a time period from your recorded data to generate a blockchain-verified speed proof.
          </Text>

            {/* Available Data Summary */}
            {isLoadingData ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#4CAF50" />
                <Text style={styles.loadingText}>Loading your speed data...</Text>
              </View>
            ) : (
              <View style={styles.dataOverview}>
                <Text style={styles.dataTitle}>📊 Available Data</Text>
                <View style={styles.dataStats}>
                  <View style={styles.statItem}>
                    <Text style={styles.statNumber}>{availableRecords.length}</Text>
                    <Text style={styles.statLabel}>Speed Records</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statNumber}>{availableCheckpoints.length}</Text>
                    <Text style={styles.statLabel}>Blockchain Checkpoints</Text>
                  </View>
                </View>
                
                {availableRecords.length > 0 && (
                  <View style={styles.dateRangeInfo}>
                    <Text style={styles.dateRangeLabel}>Data Available From:</Text>
                    <Text style={styles.dateRangeText}>
                      {new Date(availableRecords[0].timestamp).toLocaleDateString()} to{' '}
                      {new Date(availableRecords[availableRecords.length - 1].timestamp).toLocaleDateString()}
          </Text>
                  </View>
                )}
              </View>
            )}

            {/* Recent Blockchain Checkpoints */}
            {availableCheckpoints.length > 0 && (
              <View style={styles.checkpointsSection}>
                <Text style={styles.sectionTitle}>🔗 Available Blockchain Checkpoints</Text>
                <FlatList
                  data={availableCheckpoints.slice(0, 5)}
                  keyExtractor={(item, index) => index.toString()}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={styles.checkpointItem}
                      onPress={() => {
                        // Set a proper time range around the checkpoint
                        const checkpointStart = new Date(item.startTime);
                        const checkpointEnd = new Date(item.endTime);
                        
                        // If start and end are the same, create a 1-hour window around it
                        if (checkpointStart.getTime() === checkpointEnd.getTime()) {
                          const centerTime = checkpointStart.getTime();
                          setStartDate(new Date(centerTime - 30 * 60 * 1000)); // 30 minutes before
                          setEndDate(new Date(centerTime + 30 * 60 * 1000));   // 30 minutes after
                        } else {
                          setStartDate(checkpointStart);
                          setEndDate(checkpointEnd);
                        }
                      }}
                    >
                      <View style={styles.checkpointHeader}>
                        <Ionicons name="time-outline" size={16} color="#666" />
                        <Text style={styles.checkpointTime}>
                          {new Date(item.startTime).toLocaleString()}
          </Text>
                      </View>
                      <Text style={styles.checkpointStats}>
                        Avg: {item.avgSpeed} mph • Max: {item.maxSpeed} mph • Records: {item.recordCount}
          </Text>
                    </TouchableOpacity>
                  )}
                  scrollEnabled={false}
                />
                <Text style={styles.tapHint}>💡 Tap a checkpoint to select its time period</Text>
              </View>
            )}

            {/* Quick Presets */}
            <View style={styles.quickPresetsSection}>
              <Text style={styles.sectionTitle}>⚡ Quick Select</Text>
              <View style={styles.presetButtons}>
                <TouchableOpacity 
                  style={styles.presetButton}
                  onPress={() => {
                    const now = new Date();
                    setStartDate(new Date(now.getTime() - 60 * 60 * 1000)); // 1 hour ago
                    setEndDate(now);
                  }}
                >
                  <Text style={styles.presetButtonText}>Last Hour</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.presetButton}
                  onPress={() => {
                    const now = new Date();
                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    setStartDate(today);
                    setEndDate(now);
                  }}
                >
                  <Text style={styles.presetButtonText}>Today</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.presetButton}
                  onPress={() => {
                    const now = new Date();
                    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
                    const yesterdayEnd = new Date(yesterdayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
                    setStartDate(yesterdayStart);
                    setEndDate(yesterdayEnd);
                  }}
                >
                  <Text style={styles.presetButtonText}>Yesterday</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Date/Time Selection */}
            <View style={styles.dateTimeSection}>
              <Text style={styles.sectionTitle}>📅 Custom Time Period</Text>
              
              {/* Start Date/Time */}
              <View style={styles.dateTimeGroup}>
                <Text style={styles.dateTimeLabel}>From:</Text>
                <View style={styles.dateTimeRow}>
                                    <TouchableOpacity 
                    style={styles.dateButton}
                    onPress={() => openDateTimePicker('start', 'date')}
                  >
                    <Ionicons name="calendar-outline" size={20} color="#4CAF50" />
                    <Text style={styles.dateButtonText}>
                      {startDate.toLocaleDateString()}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={styles.timeButton}
                    onPress={() => openDateTimePicker('start', 'time')}
                  >
                    <Ionicons name="time-outline" size={20} color="#4CAF50" />
                    <Text style={styles.timeButtonText}>
                      {startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* End Date/Time */}
              <View style={styles.dateTimeGroup}>
                <Text style={styles.dateTimeLabel}>To:</Text>
                <View style={styles.dateTimeRow}>
                                    <TouchableOpacity 
                    style={styles.dateButton}
                    onPress={() => openDateTimePicker('end', 'date')}
                  >
                    <Ionicons name="calendar-outline" size={20} color="#2196F3" />
                    <Text style={styles.dateButtonText}>
                      {endDate.toLocaleDateString()}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={styles.timeButton}
                    onPress={() => openDateTimePicker('end', 'time')}
                  >
                    <Ionicons name="time-outline" size={20} color="#2196F3" />
                    <Text style={styles.timeButtonText}>
                      {endDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.generateButton, isGeneratingProof && styles.disabledButton]}
              onPress={generateSpeedProof}
              disabled={isGeneratingProof}
            >
              {isGeneratingProof ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Ionicons name="shield-checkmark" size={20} color="white" />
              )}
              <Text style={styles.buttonText}>
                {isGeneratingProof ? 'Generating Proof...' : 'Generate Blockchain Proof'}
          </Text>
            </TouchableOpacity>

            {/* Proof Results */}
            {console.log('Rendering ProfileScreen, proofResult:', !!proofResult, proofResult ? 'has data' : 'no data')}
            {proofResult && (
              <View style={styles.proofResultsContainer}>
                <Text style={styles.resultsTitle}>🛡️ Legal Speed Proof Generated</Text>
                
                {/* Summary */}
                <View style={styles.proofSection}>
                  <Text style={styles.proofSectionTitle}>Time Period</Text>
                  <Text style={styles.proofText}>
                    From: {proofResult.timeframe.start.toLocaleString()}
          </Text>
                  <Text style={styles.proofText}>
                    To: {proofResult.timeframe.end.toLocaleString()}
          </Text>
                  <Text style={styles.proofText}>
                    Duration: {Math.round(proofResult.timeframe.duration)} minutes
          </Text>
        </View>

                {/* Speed Statistics */}
                <View style={styles.proofSection}>
                  <Text style={styles.proofSectionTitle}>Speed Statistics</Text>
                  <Text style={styles.proofText}>Average Speed: {proofResult.statistics.avgSpeed} mph</Text>
                  <Text style={styles.proofText}>Maximum Speed: {proofResult.statistics.maxSpeed} mph</Text>
                  <Text style={styles.proofText}>Minimum Speed: {proofResult.statistics.minSpeed} mph</Text>
                  <Text style={styles.proofText}>Total Distance: {proofResult.statistics.totalDistance} miles</Text>
                  <Text style={styles.proofText}>Data Points: {proofResult.statistics.recordCount}</Text>
                </View>

                {/* Blockchain Verification */}
                <View style={styles.proofSection}>
                  <Text style={styles.proofSectionTitle}>Blockchain Verification</Text>
                  <View style={styles.verificationRow}>
                    <Ionicons 
                      name={proofResult.verification.blockchainVerified ? "checkmark-circle" : "close-circle"} 
                      size={20} 
                      color={proofResult.verification.blockchainVerified ? "#4CAF50" : "#f44336"} 
                    />
                    <Text style={[
                      styles.proofText, 
                      { color: proofResult.verification.blockchainVerified ? "#4CAF50" : "#f44336" }
                    ]}>
                      {proofResult.verification.blockchainVerified ? 'Verified on Blockchain' : 'Verification Failed'}
          </Text>
                  </View>
                  <Text style={styles.proofText}>
                    Checkpoints: {proofResult.verification.checkpointsVerified}/{proofResult.verification.checkpointsFound} verified
          </Text>
                  <Text style={styles.proofText}>Network: {proofResult.verification.network}</Text>
                  
                  <TouchableOpacity 
                    style={styles.contractButton}
                    onPress={() => copyToClipboard(proofResult.verification.contractAddress, 'Contract address')}
                  >
                    <Text style={styles.contractText}>
                      Contract: {proofResult.verification.contractAddress}
          </Text>
                    <Ionicons name="copy-outline" size={16} color="#666" />
                  </TouchableOpacity>
                </View>

                {/* Legal Notice */}
                <View style={styles.legalNotice}>
                  <Ionicons name="information-circle" size={20} color="#FF9800" />
                  <Text style={styles.legalText}>
                    This proof is cryptographically verified on the {CURRENT_CHAIN_CONFIG.displayName} blockchain and can be used as evidence in legal proceedings.
          </Text>
        </View>

                {/* Actions */}
                <View style={styles.proofActions}>
                  <TouchableOpacity 
                    style={styles.copyProofButton}
                    onPress={() => copyToClipboard(JSON.stringify(proofResult, null, 2), 'Speed proof')}
                  >
                    <Ionicons name="copy-outline" size={20} color="white" />
                    <Text style={styles.buttonText}>Copy Full Proof</Text>
                  </TouchableOpacity>
                </View>
              </View>
                        )}
      </ScrollView>

          {/* Integrated Date/Time Picker Modal */}
          {showDateTimePicker && (
            <Modal
              visible={showDateTimePicker}
              transparent={true}
              animationType="fade"
            >
              <View style={styles.pickerModalOverlay}>
                <View style={styles.pickerModalContent}>
                  <View style={styles.pickerHeader}>
                    <TouchableOpacity onPress={cancelDateTimeSelection}>
                      <Text style={styles.pickerButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={styles.pickerTitle}>
                      Select {pickerMode === 'date' ? 'Date' : 'Time'} ({pickerType === 'start' ? 'From' : 'To'})
                    </Text>
                    <TouchableOpacity onPress={confirmDateTimeSelection}>
                      <Text style={[styles.pickerButtonText, styles.confirmButton]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <DateTimePicker
                    value={tempDate}
                    mode={pickerMode}
                    display="spinner"
                    onChange={handleDateTimeChange}
                    style={styles.dateTimePicker}
                  />
                </View>
              </View>
            </Modal>
          )}
        </SafeAreaView>
      </Modal>
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
  walletCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  walletInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  walletDetails: {
    marginLeft: 12,
    flex: 1,
  },
  walletStatus: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  walletAddress: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '600',
    marginLeft: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: 'bold',
  },
  connected: {
    color: '#4CAF50',
  },
  disconnected: {
    color: '#f44336',
  },
  warning: {
    color: '#FF9800',
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF3E0',
    padding: 10,
    borderRadius: 6,
    marginTop: 10,
  },
  warningText: {
    fontSize: 12,
    color: '#E65100',
    marginLeft: 8,
    flex: 1,
    lineHeight: 16,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    padding: 8,
    borderRadius: 6,
    flex: 1,
    marginLeft: 10,
  },
  addressText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
    flex: 1,
  },
  contractText: {
    fontSize: 10,
    color: '#333',
    fontFamily: 'monospace',
    flex: 1,
  },
  buttonContainer: {
    marginVertical: 20,
  },

  actionButton: {
    backgroundColor: '#FF9800',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  dangerButton: {
    backgroundColor: '#f44336',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  warningButton: {
    backgroundColor: '#9E9E9E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },

  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 15,
  },
  proofButton: {
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  modalDescription: {
    fontSize: 16,
    color: '#666',
    lineHeight: 22,
    marginBottom: 20,
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  generateButton: {
    backgroundColor: '#2196F3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  proofResultsContainer: {
    backgroundColor: '#f0fff4', // Light green background
    borderRadius: 10,
    padding: 20,
    marginTop: 20,
    borderWidth: 2,
    borderColor: '#4CAF50',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4CAF50',
    textAlign: 'center',
    marginBottom: 20,
  },
  proofSection: {
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  proofSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  proofText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  verificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  contractButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    padding: 8,
    borderRadius: 6,
    marginTop: 5,
  },
  legalNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF3E0',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  legalText: {
    fontSize: 14,
    color: '#FF9800',
    marginLeft: 10,
    flex: 1,
    lineHeight: 20,
  },
  proofActions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  copyProofButton: {
    backgroundColor: '#FF9800',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
  },
  dataOverview: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  dataTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
    textAlign: 'center',
  },
  dataStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 15,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  dateRangeInfo: {
    backgroundColor: '#f8f8f8',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  dateRangeLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  dateRangeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  checkpointsSection: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  checkpointItem: {
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  checkpointHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  checkpointTime: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  checkpointStats: {
    fontSize: 14,
    color: '#666',
  },
  tapHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 10,
  },
  dateTimeSection: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  dateTimeGroup: {
    marginBottom: 20,
  },
  dateTimeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E8',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  timeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  dateButtonText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '600',
    marginLeft: 10,
  },
  timeButtonText: {
    fontSize: 16,
    color: '#2196F3',
    fontWeight: '600',
    marginLeft: 10,
  },
  pickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerModalContent: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 0,
    margin: 20,
    minWidth: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  pickerButtonText: {
    fontSize: 16,
    color: '#2196F3',
    fontWeight: '600',
  },
  confirmButton: {
    color: '#4CAF50',
  },
  dateTimePicker: {
    backgroundColor: 'white',
  },
  quickPresetsSection: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  presetButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 10,
  },
  presetButton: {
    flex: 1,
    backgroundColor: '#E3F2FD',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
    alignItems: 'center',
  },
  presetButtonText: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: '600',
  },
});