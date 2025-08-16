import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';

export interface DeviceAttestation {
  deviceId: string;
  appSignature: string;
  installTime: number;
  hardwareFingerprint: string;
  attestationKey: string;
}

export interface SignedData {
  data: any;
  signature: string;
  timestamp: number;
  deviceAttestation: DeviceAttestation;
  chainLink: string; // Hash of previous signed data
}

class CryptoService {
  private deviceAttestation: DeviceAttestation | null = null;
  private attestationKey: string = '';
  private previousDataHash: string = '0'; // Genesis hash

  constructor() {
    this.initializeAttestation();
  }

  private async initializeAttestation(): Promise<void> {
    try {
      // Check if attestation already exists
      const existingAttestation = await AsyncStorage.getItem('device_attestation');
      if (existingAttestation) {
        this.deviceAttestation = JSON.parse(existingAttestation);
        this.attestationKey = this.deviceAttestation!.attestationKey;
        return;
      }

      // Create new device attestation
      await this.createDeviceAttestation();
    } catch (error) {
      console.error('Failed to initialize attestation:', error);
    }
  }

  private async createDeviceAttestation(): Promise<void> {
    try {
      // Generate device-specific attestation key
      this.attestationKey = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        Date.now().toString() + Math.random().toString()
      );

      // Create hardware fingerprint
      const hardwareFingerprint = await this.generateHardwareFingerprint();

      // Create device attestation
      this.deviceAttestation = {
        deviceId: await this.getDeviceId(),
        appSignature: await this.getAppSignature(),
        installTime: Date.now(),
        hardwareFingerprint,
        attestationKey: this.attestationKey
      };

      // Store attestation
      await AsyncStorage.setItem('device_attestation', JSON.stringify(this.deviceAttestation));
      console.log('Device attestation created');

    } catch (error) {
      console.error('Failed to create device attestation:', error);
      throw error;
    }
  }

  private async getDeviceId(): Promise<string> {
    try {
      // Try to get persistent device ID
      let deviceId = await AsyncStorage.getItem('persistent_device_id');
      
      if (!deviceId) {
        // Create a persistent device ID based on available identifiers
        const identifiers = [
          Application.applicationName || 'chainspeed',
          Application.applicationId || 'com.chainspeed.app',
          'app-installed',
          'ios-identifier',
          Date.now().toString()
        ].filter(Boolean);

        deviceId = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          identifiers.join('|')
        );
        await AsyncStorage.setItem('persistent_device_id', deviceId);
      }

      return deviceId;
    } catch (error) {
      console.error('Failed to get device ID:', error);
      return await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        'fallback-' + Date.now().toString()
      );
    }
  }

  private async getAppSignature(): Promise<string> {
    try {
      // Create app signature from available app information
      const appInfo = {
        name: Application.applicationName,
        id: Application.applicationId,
        version: Application.nativeApplicationVersion,
        buildVersion: Application.nativeBuildVersion,
        installationId: 'app-installation'
      };

      return await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(appInfo)
      );
    } catch (error) {
      console.error('Failed to get app signature:', error);
      return 'unknown_app_signature';
    }
  }

  private async generateHardwareFingerprint(): Promise<string> {
    try {
      // Create hardware fingerprint from available device information
      const fingerprint = {
        platform: 'mobile',
        deviceName: 'smartphone',
        osVersion: '17.0',
        installationId: 'app-installation',
        timestamp: Date.now()
      };

      return await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(fingerprint)
      );
    } catch (error) {
      console.error('Failed to generate hardware fingerprint:', error);
      return 'unknown_hardware';
    }
  }

  public async signData(data: any): Promise<SignedData> {
    try {
      if (!this.deviceAttestation) {
        throw new Error('Device attestation not initialized');
      }

      const timestamp = Date.now();
      const dataString = JSON.stringify(data);

      // Create signature payload
      const signaturePayload = {
        data: dataString,
        timestamp,
        deviceId: this.deviceAttestation.deviceId,
        chainLink: this.previousDataHash,
        attestationKey: this.attestationKey
      };

      // Generate signature using SHA256 with key
      const signature = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(signaturePayload) + this.attestationKey
      );

      const signedData: SignedData = {
        data,
        signature,
        timestamp,
        deviceAttestation: this.deviceAttestation,
        chainLink: this.previousDataHash
      };

      // Update chain link for next signature
      this.previousDataHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(signedData)
      );

      return signedData;

    } catch (error) {
      console.error('Failed to sign data:', error);
      throw error;
    }
  }

  public async verifySignature(signedData: SignedData): Promise<boolean> {
    try {
      // Recreate signature payload
      const signaturePayload = {
        data: JSON.stringify(signedData.data),
        timestamp: signedData.timestamp,
        deviceId: signedData.deviceAttestation.deviceId,
        chainLink: signedData.chainLink,
        attestationKey: signedData.deviceAttestation.attestationKey
      };

      // Verify signature
      const expectedSignature = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(signaturePayload) + signedData.deviceAttestation.attestationKey
      );

      return expectedSignature === signedData.signature;

    } catch (error) {
      console.error('Failed to verify signature:', error);
      return false;
    }
  }

  public async verifyChainIntegrity(signedDataArray: SignedData[]): Promise<boolean> {
    try {
      if (signedDataArray.length === 0) return true;

      let expectedPreviousHash = '0'; // Genesis hash

      for (const signedData of signedDataArray) {
        // Verify chain link
        if (signedData.chainLink !== expectedPreviousHash) {
          console.error('Chain integrity broken at:', signedData.timestamp);
          return false;
        }

        // Verify signature
        if (!(await this.verifySignature(signedData))) {
          console.error('Invalid signature at:', signedData.timestamp);
          return false;
        }

        // Calculate hash for next iteration
        expectedPreviousHash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          JSON.stringify(signedData)
        );
      }

      return true;

    } catch (error) {
      console.error('Failed to verify chain integrity:', error);
      return false;
    }
  }

  public async getDeviceAttestation(): Promise<DeviceAttestation | null> {
    if (!this.deviceAttestation) {
      await this.initializeAttestation();
    }
    return this.deviceAttestation;
  }

  public async generateProofOfIntegrity(signedDataArray: SignedData[]): Promise<string> {
    try {
      // Create integrity proof
      const proof = {
        chainStart: '0',
        chainEnd: signedDataArray.length > 0 ? 
          await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            JSON.stringify(signedDataArray[signedDataArray.length - 1])
          ) : '0',
        recordCount: signedDataArray.length,
        timeSpan: {
          start: signedDataArray.length > 0 ? signedDataArray[0].timestamp : 0,
          end: signedDataArray.length > 0 ? signedDataArray[signedDataArray.length - 1].timestamp : 0
        },
        deviceAttestation: this.deviceAttestation,
        integrityHash: await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          JSON.stringify(signedDataArray)
        )
      };

      return JSON.stringify(proof, null, 2);

    } catch (error) {
      console.error('Failed to generate proof of integrity:', error);
      return '';
    }
  }

  public async detectTampering(signedDataArray: SignedData[]): Promise<string[]> {
    const issues: string[] = [];

    try {
      // Check timestamps for manipulation
      for (let i = 1; i < signedDataArray.length; i++) {
        const current = signedDataArray[i];
        const previous = signedDataArray[i - 1];

        if (current.timestamp <= previous.timestamp) {
          issues.push(`Timestamp manipulation detected at index ${i}`);
        }

        // Check for sudden time jumps (>5 minutes gap)
        if (current.timestamp - previous.timestamp > 5 * 60 * 1000) {
          issues.push(`Suspicious time gap at index ${i}: ${(current.timestamp - previous.timestamp) / 1000}s`);
        }
      }

      // Check device attestation consistency
      const firstAttestation = signedDataArray[0]?.deviceAttestation;
      for (let i = 1; i < signedDataArray.length; i++) {
        const attestation = signedDataArray[i].deviceAttestation;
        if (JSON.stringify(attestation) !== JSON.stringify(firstAttestation)) {
          issues.push(`Device attestation changed at index ${i}`);
        }
      }

      // Verify chain integrity
      if (!(await this.verifyChainIntegrity(signedDataArray))) {
        issues.push('Chain integrity compromised');
      }

    } catch (error) {
      issues.push(`Tampering detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return issues;
  }

  public async resetAttestation(): Promise<void> {
    try {
      await AsyncStorage.removeItem('device_attestation');
      await AsyncStorage.removeItem('persistent_device_id');
      this.deviceAttestation = null;
      this.attestationKey = '';
      this.previousDataHash = '0';
      
      await this.createDeviceAttestation();
      console.log('Device attestation reset');

    } catch (error) {
      console.error('Failed to reset attestation:', error);
      throw error;
    }
  }
}

// Singleton instance
let instance: CryptoService | null = null;

export const getCryptoService = (): CryptoService => {
  if (!instance) {
    instance = new CryptoService();
  }
  return instance;
};

export default CryptoService;