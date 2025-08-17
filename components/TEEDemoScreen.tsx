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

interface TEEStatus {
  keyGenerated: boolean;
  sessionActive: boolean;
  hardwareBacked: boolean;
  publicKey?: string;
  keyAge?: number;
}

interface TEESignature {
  signature: string;
  publicKey: string;
  timestamp: number;
  chainLink: string;
  isHardwareSigned: boolean;
}

export default function TEESecureEnclaveScreen() {
  const [teeStatus, setTeeStatus] = useState<TEEStatus>({
    keyGenerated: false,
    sessionActive: false,
    hardwareBacked: false,
  });
  const [lastSignature, setLastSignature] = useState<TEESignature | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    updateTEEStatus();
  }, []);

  const updateTEEStatus = async () => {
    try {
      const { getTEECryptoService } = await import('../services/TEECryptoService');
      const teeService = getTEECryptoService();
      const status = await teeService.getTEEStatus();
      setTeeStatus(status);
    } catch (error) {
      console.warn('Could not get TEE status:', error);
    }
  };

  const initializeTEE = async () => {
    setIsLoading(true);
    try {
      const { getTEECryptoService } = await import('../services/TEECryptoService');
      const teeService = getTEECryptoService();
      
      await teeService.initialize();
      Alert.alert('Success', 'TEE Secure Enclave initialized successfully!');
      await updateTEEStatus();
    } catch (error) {
      console.error('TEE initialization failed:', error);
      Alert.alert('Error', 'Failed to initialize TEE: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  };

  const authenticateSession = async () => {
    setIsLoading(true);
    try {
      const { getTEECryptoService } = await import('../services/TEECryptoService');
      const teeService = getTEECryptoService();
      
      await teeService.authenticateSession();
      Alert.alert('Success', 'TEE session authenticated with Face ID/Touch ID!');
      await updateTEEStatus();
    } catch (error) {
      console.error('TEE authentication failed:', error);
      Alert.alert('Authentication Failed', 'Could not authenticate with Secure Enclave');
    } finally {
      setIsLoading(false);
    }
  };

  const testHardwareSigning = async () => {
    setIsLoading(true);
    try {
      const { getTEECryptoService } = await import('../services/TEECryptoService');
      const teeService = getTEECryptoService();
      
      // Create mock speed data for testing
      const mockSpeedData = {
        timestamp: Date.now(),
        latitude: 37.7749,
        longitude: -122.4194,
        speed: Math.random() * 60 + 20, // Random speed between 20-80 mph
        accuracy: Math.random() * 10 + 5, // Random accuracy between 5-15m
        accelerometer: { x: 0.1, y: 0.2, z: 9.8 },
        heading: Math.random() * 360
      };
      
      const signature = await teeService.signSpeedData(mockSpeedData);
      setLastSignature(signature);
      
      Alert.alert(
        'Hardware Signing Success!', 
        `Speed data signed with Secure Enclave.\n\nSignature: ${signature.signature.substring(0, 30)}...`
      );
      
    } catch (error) {
      console.error('Hardware signing failed:', error);
      Alert.alert('Signing Failed', 'Could not sign data with TEE: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Ionicons name="shield-checkmark" size={40} color="#9C27B0" />
          <Text style={styles.title}>Secure Enclave Control</Text>
          <Text style={styles.subtitle}>Hardware-backed Cryptographic Signing</Text>
        </View>

        {/* TEE Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔐 Secure Enclave Status</Text>
          
          <View style={styles.statusRow}>
            <View style={[styles.indicator, teeStatus.keyGenerated ? styles.green : styles.red]} />
            <Text style={styles.statusText}>
              Hardware Key: {teeStatus.keyGenerated ? 'Generated' : 'Not Generated'}
            </Text>
          </View>
          
          <View style={styles.statusRow}>
            <View style={[styles.indicator, teeStatus.hardwareBacked ? styles.green : styles.red]} />
            <Text style={styles.statusText}>
              Hardware Backed: {teeStatus.hardwareBacked ? 'Yes' : 'No'}
            </Text>
          </View>
          
          <View style={styles.statusRow}>
            <View style={[styles.indicator, teeStatus.sessionActive ? styles.green : styles.orange]} />
            <Text style={styles.statusText}>
              Session: {teeStatus.sessionActive ? 'Authenticated' : 'Requires Auth'}
            </Text>
          </View>

          {teeStatus.publicKey && (
            <View style={styles.keyInfo}>
              <Text style={styles.keyLabel}>Public Key:</Text>
              <Text style={styles.keyValue}>{teeStatus.publicKey}</Text>
            </View>
          )}
        </View>

        {/* Control Buttons */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🛠️ TEE Controls</Text>
          
          {!teeStatus.keyGenerated && (
            <TouchableOpacity 
              style={[styles.button, styles.initButton]} 
              onPress={initializeTEE}
              disabled={isLoading}
            >
              <Ionicons name="key" size={20} color="white" />
              <Text style={styles.buttonText}>Initialize TEE</Text>
            </TouchableOpacity>
          )}

          {teeStatus.keyGenerated && !teeStatus.sessionActive && (
            <TouchableOpacity 
              style={[styles.button, styles.authButton]} 
              onPress={authenticateSession}
              disabled={isLoading}
            >
              <Ionicons name="finger-print" size={20} color="white" />
              <Text style={styles.buttonText}>Authenticate Session</Text>
            </TouchableOpacity>
          )}

          {teeStatus.sessionActive && (
            <TouchableOpacity 
              style={[styles.button, styles.signButton]} 
              onPress={testHardwareSigning}
              disabled={isLoading}
            >
              <Ionicons name="create" size={20} color="white" />
              <Text style={styles.buttonText}>Test Hardware Signing</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Last Signature */}
        {lastSignature && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>✍️ Last Hardware Signature</Text>
            
            <View style={styles.signatureInfo}>
              <Text style={styles.signatureLabel}>Signature Type:</Text>
              <Text style={[styles.signatureValue, styles.hardwareTag]}>
                {lastSignature.isHardwareSigned && lastSignature.signature.startsWith('TEE-HW:') 
                  ? '🔐 REAL SECURE ENCLAVE' 
                  : lastSignature.isHardwareSigned 
                    ? '🔐 HARDWARE-BACKED' 
                    : '💻 SOFTWARE'}
              </Text>
            </View>
            
            <View style={styles.signatureInfo}>
              <Text style={styles.signatureLabel}>Timestamp:</Text>
              <Text style={styles.signatureValue}>
                {new Date(lastSignature.timestamp).toLocaleString()}
              </Text>
            </View>
            
            <View style={styles.signatureInfo}>
              <Text style={styles.signatureLabel}>Signature:</Text>
              <Text style={styles.signatureValue} numberOfLines={3}>
                {lastSignature.signature}
              </Text>
            </View>
            
            <View style={styles.signatureInfo}>
              <Text style={styles.signatureLabel}>Chain Link:</Text>
              <Text style={styles.signatureValue}>
                {lastSignature.chainLink.substring(0, 16)}...
              </Text>
            </View>
          </View>
        )}

        {/* Benefits */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🛡️ Security Benefits</Text>
          <View style={styles.benefitsList}>
            <Text style={styles.benefit}>✅ Private keys never leave Secure Enclave</Text>
            <Text style={styles.benefit}>✅ Tamper-proof signature generation</Text>
            <Text style={styles.benefit}>✅ Hardware attestation certificates</Text>
            <Text style={styles.benefit}>✅ Biometric authentication required</Text>
            <Text style={styles.benefit}>✅ Court-admissible evidence</Text>
          </View>
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
  scrollView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 10,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
  section: {
    backgroundColor: 'white',
    margin: 10,
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  indicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  green: {
    backgroundColor: '#4CAF50',
  },
  red: {
    backgroundColor: '#f44336',
  },
  orange: {
    backgroundColor: '#FF9800',
  },
  statusText: {
    fontSize: 16,
    color: '#333',
  },
  keyInfo: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f8f8f8',
    borderRadius: 5,
  },
  keyLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
  },
  keyValue: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333',
    marginTop: 5,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  initButton: {
    backgroundColor: '#2196F3',
  },
  authButton: {
    backgroundColor: '#9C27B0',
  },
  signButton: {
    backgroundColor: '#4CAF50',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  signatureInfo: {
    marginBottom: 10,
  },
  signatureLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
  },
  signatureValue: {
    fontSize: 14,
    color: '#333',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  hardwareTag: {
    color: '#9C27B0',
    fontWeight: 'bold',
  },
  benefitsList: {
    marginTop: 10,
  },
  benefit: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
    lineHeight: 20,
  },
});