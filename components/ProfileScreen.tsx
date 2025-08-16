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
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { usePrivy, useEmbeddedEthereumWallet, getUserEmbeddedEthereumWallet } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import { getBlockchainService } from '../services/BlockchainService';
import { CONTRACT_CONFIG } from '../constants/Blockchain';

interface ProfileScreenProps {
  navigation?: any;
}

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { user, logout } = usePrivy();
  const { wallets, create } = useEmbeddedEthereumWallet();
  const account = getUserEmbeddedEthereumWallet(user);
  const authenticated = !!user;
  const router = useRouter();
  const [pendingCheckpoints, setPendingCheckpoints] = useState(0);
  const [networkInfo, setNetworkInfo] = useState<any>(null);

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
    const info = blockchainService.getNetworkInfo();
    
    setPendingCheckpoints(pending.length);
    setNetworkInfo(info);
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
                Alert.alert('Info', 'No checkpoints were submitted. Make sure your wallet has testnet FLOW.');
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

  const openTestnetFaucet = () => {
    Alert.alert(
      'Get Testnet FLOW',
      'To get testnet FLOW tokens:\n\n1. Copy your wallet address\n2. Visit the Flow testnet faucet\n3. Paste your address and request tokens',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Copy Address', 
          onPress: () => copyToClipboard(getWalletAddress(), 'Wallet address')
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Profile & Settings</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Wallet Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet Information</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Status:</Text>
            <Text style={[styles.infoValue, authenticated ? styles.connected : styles.disconnected]}>
              {authenticated ? 'Connected' : 'Disconnected'}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Address:</Text>
            <TouchableOpacity 
              style={styles.addressContainer}
              onPress={() => copyToClipboard(getWalletAddress(), 'Wallet address')}
            >
              <Text style={styles.addressText}>
                {getWalletAddress()}
              </Text>
              <Ionicons name="copy-outline" size={16} color="#666" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Network Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Network</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Network:</Text>
            <Text style={styles.infoValue}>{networkInfo?.network || 'Flow EVM Testnet'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Chain ID:</Text>
            <Text style={styles.infoValue}>{networkInfo?.chainId || '545'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Contract:</Text>
            <TouchableOpacity 
              style={styles.addressContainer}
              onPress={() => copyToClipboard(CONTRACT_CONFIG.address, 'Contract address')}
            >
              <Text style={styles.contractText}>
                {CONTRACT_CONFIG.address}
              </Text>
              <Ionicons name="copy-outline" size={16} color="#666" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Blockchain Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blockchain Status</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Connection:</Text>
            <Text style={[styles.infoValue, networkInfo?.connected ? styles.connected : styles.disconnected]}>
              {networkInfo?.connected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Pending Checkpoints:</Text>
            <Text style={styles.infoValue}>{pendingCheckpoints}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.primaryButton} onPress={openTestnetFaucet}>
            <Ionicons name="wallet-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Get Testnet FLOW</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.networkButton} 
            onPress={async () => {
              try {
                if (account?.address && wallets.length > 0) {
                  Alert.alert('Switching Network', 'Switching to Flow EVM testnet...');
                  
                  const blockchainService = getBlockchainService();
                  const wallet = wallets[0];
                  
                  // Try wallet.switchChain first (preferred Privy method)
                  let success = await blockchainService.switchNetworkUsingWallet(wallet);
                  
                  if (!success) {
                    // Fallback to provider method
                    console.log('Trying provider method...');
                    const provider = await wallet.getProvider();
                    await blockchainService.setWalletProvider(provider);
                    success = true;
                  }
                  
                  if (success) {
                    Alert.alert('Success', 'Switched to Flow EVM testnet network');
                    await loadProfileData();
                  } else {
                    Alert.alert('Error', 'Failed to switch network. Make sure Flow EVM testnet is configured.');
                  }
                } else {
                  Alert.alert('Error', 'No wallet available');
                }
              } catch (error: any) {
                console.error('Failed to switch network:', error);
                if (error.message?.includes('Unsupported chainId')) {
                  Alert.alert(
                    'Configuration Required', 
                    'Flow EVM testnet (Chain ID 545) is not configured in your Privy app.\n\nPlease add it in the Privy dashboard:\n• Chain ID: 545\n• RPC: https://testnet.evm.nodes.onflow.org'
                  );
                } else {
                  Alert.alert('Error', 'Failed to switch network. Please try again.');
                }
              }
            }}
          >
            <Ionicons name="swap-horizontal-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Switch to Flow EVM</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.debugButton} 
            onPress={async () => {
              try {
                if (wallets.length > 0) {
                  const provider = await wallets[0].getProvider();
                  const chainId = await provider.request({ method: 'eth_chainId' });
                  const chainIdDecimal = parseInt(chainId, 16);
                  
                  Alert.alert(
                    'Current Network',
                    `Chain ID: ${chainIdDecimal}\n\nNote: Flow EVM testnet (545) needs to be configured in your Privy app settings.`
                  );
                } else {
                  Alert.alert('Error', 'No wallet available');
                }
              } catch (error) {
                console.error('Failed to get chain info:', error);
                Alert.alert('Error', 'Failed to get network info');
              }
            }}
          >
            <Ionicons name="information-circle-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Check Current Network</Text>
          </TouchableOpacity>

          {pendingCheckpoints > 0 && (
            <>
              <TouchableOpacity style={styles.actionButton} onPress={submitPendingCheckpoints}>
                <Ionicons name="cloud-upload-outline" size={20} color="white" />
                <Text style={styles.buttonText}>Submit Pending Checkpoints</Text>
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

          <TouchableOpacity style={styles.dangerButton} onPress={logout}>
            <Ionicons name="log-out-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {/* Instructions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <Text style={styles.instructionText}>
            ⚠️ IMPORTANT: Flow EVM (Chain ID 545) is not configured in Privy
          </Text>
          <Text style={styles.instructionText}>
            Please add Flow EVM testnet to your Privy app configuration:
          </Text>
          <Text style={styles.instructionText}>
            • Chain ID: 545
          </Text>
          <Text style={styles.instructionText}>
            • RPC: https://testnet.evm.nodes.onflow.org
          </Text>
          <Text style={styles.instructionText}>
            • Currency: FLOW
          </Text>
          <View style={styles.divider} />
          <Text style={styles.instructionText}>
            Once configured:
          </Text>
          <Text style={styles.instructionText}>
            1. Copy wallet address and get testnet FLOW
          </Text>
          <Text style={styles.instructionText}>
            2. Switch to Flow EVM network
          </Text>
          <Text style={styles.instructionText}>
            3. Submit checkpoints to blockchain
          </Text>
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
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 40,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
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
  primaryButton: {
    backgroundColor: '#2196F3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  networkButton: {
    backgroundColor: '#9C27B0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
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
  debugButton: {
    backgroundColor: '#607D8B',
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
  instructionText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 15,
  },
});