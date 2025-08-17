import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

export interface SpeedRecord {
  timestamp: number;        // Unix milliseconds
  latitude: number;         // 6 decimal precision
  longitude: number;        // 6 decimal precision
  speed: number;           // mph from GPS
  accuracy: number;        // GPS accuracy in meters
  accelerometer: {x: number, y: number, z: number};
  gyroscope: {x: number, y: number, z: number};
  heading: number;         // degrees
  altitude: number;        // meters
  signature: string;       // Software attestation
}

interface SensorData {
  accelerometer: {x: number, y: number, z: number};
  gyroscope: {x: number, y: number, z: number};
  magnetometer: {x: number, y: number, z: number};
}

const LOCATION_TASK_NAME = 'background-location-task';
const STORAGE_KEY = 'speed_records';
const MIN_SPEED_THRESHOLD = 0; // mph - track all movement including stopped (for legal coverage)
const GPS_ACCURACY_THRESHOLD = 100; // meters - more lenient for legal coverage (indoor/poor signal)

class LocationServiceClass {
  private isTracking = false;
  private sensorData: SensorData = {
    accelerometer: {x: 0, y: 0, z: 0},
    gyroscope: {x: 0, y: 0, z: 0},
    magnetometer: {x: 0, y: 0, z: 0}
  };
  private deviceKey: string = '';
  private previousRecord: SpeedRecord | null = null;
  private lastKnownSpeed: number = 0; // Always track last known speed

  constructor() {
    this.initializeDeviceKey();
    this.setupSensorListeners();
  }

  private async initializeDeviceKey() {
    try {
      let key = await AsyncStorage.getItem('device_key');
      if (!key) {
        // Generate device-specific key for software attestation
        key = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          'device-key-' + Date.now().toString() + Math.random().toString()
        );
        await AsyncStorage.setItem('device_key', key);
      }
      this.deviceKey = key;
    } catch (error) {
      console.error('Failed to initialize device key:', error);
    }
  }

  private setupSensorListeners() {
    // Accelerometer - 10Hz sampling
    Accelerometer.setUpdateInterval(100);
    Accelerometer.addListener(({ x, y, z }) => {
      this.sensorData.accelerometer = { x, y, z };
    });

    // Gyroscope - for turn detection
    Gyroscope.setUpdateInterval(100);
    Gyroscope.addListener(({ x, y, z }) => {
      this.sensorData.gyroscope = { x, y, z };
    });

    // Magnetometer - for heading verification
    Magnetometer.setUpdateInterval(100);
    Magnetometer.addListener(({ x, y, z }) => {
      this.sensorData.magnetometer = { x, y, z };
    });
  }

  async requestPermissions(): Promise<boolean> {
    try {
      // Request location permissions
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') {
        throw new Error('Foreground location permission denied');
      }

      // Skip background permission for Expo Go compatibility
      console.log('Note: Background location not available in Expo Go. Build a development client for full features.');

      return true;
    } catch (error) {
      console.error('Permission request failed:', error);
      return false;
    }
  }

  private calculateSpeedFromCoordinates(
    lat1: number, lon1: number, timestamp1: number,
    lat2: number, lon2: number, timestamp2: number
  ): number {
    // Haversine formula for distance calculation
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in miles
    
    const timeHours = (timestamp2 - timestamp1) / (1000 * 60 * 60);
    return timeHours > 0 ? distance / timeHours : 0;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private calculateHeading(): number {
    const { x, y } = this.sensorData.magnetometer;
    let heading = Math.atan2(y, x) * (180 / Math.PI);
    if (heading < 0) heading += 360;
    return heading;
  }

  private async generateSignature(record: Omit<SpeedRecord, 'signature'>): Promise<string> {
    try {
      // Use TEE hardware signing instead of software signing
      const TEEModule = require('./TEECryptoService');
      const teeService = TEEModule.getTEECryptoService();
      
      const teeSignature = await teeService.signSpeedData(record);
      
      // Return the hardware signature with TEE marker
      return teeSignature.signature;
      
    } catch (error) {
      console.warn('TEE signing failed, falling back to software signing:', error);
      
      // Fallback to original software signing for compatibility
      const dataString = JSON.stringify(record);
      const previousHash = this.previousRecord ? 
        await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          JSON.stringify(this.previousRecord)
        ) : '0';
      
      const signatureData = {
        data: dataString,
        deviceKey: this.deviceKey,
        previousHash,
        timestamp: Date.now()
      };

      const softwareSignature = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(signatureData)
      );
      
      return `SW:${softwareSignature}`; // Mark as software signature
    }
  }

  private async validateRecord(record: SpeedRecord): Promise<boolean> {
    // Multi-layer validation for legal coverage
    
    // 1. GPS accuracy check (more lenient for legal coverage)
    if (record.accuracy > GPS_ACCURACY_THRESHOLD) {
      console.warn('GPS accuracy too low - record rejected:', record.accuracy, 'meters (threshold:', GPS_ACCURACY_THRESHOLD, 'meters)');
      return false;
    }

    // 2. Speed consistency check (only when moving)
    if (this.previousRecord && record.speed > 0) {
      const calculatedSpeed = this.calculateSpeedFromCoordinates(
        this.previousRecord.latitude, this.previousRecord.longitude, this.previousRecord.timestamp,
        record.latitude, record.longitude, record.timestamp
      );
      
      const speedDifference = Math.abs(record.speed - calculatedSpeed);
      if (speedDifference > 15) { // More lenient for legal coverage
        console.warn('Speed inconsistency detected - record rejected:', speedDifference, 'mph difference');
        return false;
      }
    }

    // 3. Accelerometer correlation check (warning only, don't reject)
    const accelerationMagnitude = Math.sqrt(
      Math.pow(record.accelerometer.x, 2) +
      Math.pow(record.accelerometer.y, 2) +
      Math.pow(record.accelerometer.z, 2)
    );

    // Log but don't reject for accelerometer issues (sensor may vary)
    const expectedAcceleration = record.speed > 0 ? 0.8 : 0.2;
    if (Math.abs(accelerationMagnitude - expectedAcceleration) > 2) {
      console.log('Accelerometer correlation note:', accelerationMagnitude, 'vs expected:', expectedAcceleration);
    }

    console.log('Record validation passed:', {
      accuracy: record.accuracy,
      speed: record.speed,
      status: record.speed > 0 ? 'moving' : 'stopped'
    });
    
    return true;
  }

  async startTracking(): Promise<boolean> {
    try {
      if (this.isTracking) return true;

      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) return false;

      // Start sensors
      Accelerometer.setUpdateInterval(100);
      Gyroscope.setUpdateInterval(100);
      Magnetometer.setUpdateInterval(100);

      // For Expo Go compatibility, use watchPositionAsync instead of background updates
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000, // 1 second
          distanceInterval: 0, // Track all changes
        },
        async (location) => {
          await this.processLocationUpdate(location);
        }
      );

      // Store subscription for cleanup
      (this as any).locationSubscription = subscription;

      this.isTracking = true;
      console.log('Location tracking started');
      return true;

    } catch (error) {
      console.error('Failed to start tracking:', error);
      return false;
    }
  }

  async stopTracking(): Promise<void> {
    try {
      if (!this.isTracking) return;

      // Stop location subscription
      if ((this as any).locationSubscription) {
        (this as any).locationSubscription.remove();
        (this as any).locationSubscription = null;
      }
      
      // Stop sensors
      Accelerometer.removeAllListeners();
      Gyroscope.removeAllListeners();
      Magnetometer.removeAllListeners();

      this.isTracking = false;
      this.lastKnownSpeed = 0;
      
      // Clear last known speed
      await AsyncStorage.removeItem('last_known_speed');
      
      console.log('Location tracking stopped');

    } catch (error) {
      console.error('Failed to stop tracking:', error);
    }
  }

  async processLocationUpdate(location: Location.LocationObject): Promise<void> {
    try {
      // Get speed from GPS or calculate from position change
      let speed = 0;
      
      // Check if GPS provides speed
      if (location.coords.speed !== null && location.coords.speed !== undefined) {
        speed = Math.max(0, location.coords.speed * 2.237); // Convert m/s to mph, ensure non-negative
      } else if (this.previousRecord) {
        // Calculate speed from position change
        const timeDiff = Date.now() - this.previousRecord.timestamp;
        if (timeDiff > 0) {
          speed = Math.max(0, this.calculateSpeedFromCoordinates(
            this.previousRecord.latitude,
            this.previousRecord.longitude,
            this.previousRecord.timestamp,
            location.coords.latitude,
            location.coords.longitude,
            Date.now()
          )); // Ensure non-negative
        }
      }

      // Always create a record, even for 0 speed
      // This ensures the UI shows current speed including when stopped

      const record: Omit<SpeedRecord, 'signature'> = {
        timestamp: Date.now(),
        latitude: parseFloat(location.coords.latitude.toFixed(6)),
        longitude: parseFloat(location.coords.longitude.toFixed(6)),
        speed: parseFloat(speed.toFixed(2)),
        accuracy: location.coords.accuracy || 0,
        accelerometer: { ...this.sensorData.accelerometer },
        gyroscope: { ...this.sensorData.gyroscope },
        heading: this.calculateHeading(),
        altitude: location.coords.altitude || 0
      };

      // Validate record
      console.log('Processing location update:', {
        speed: speed,
        accuracy: record.accuracy,
        coords: [record.latitude, record.longitude]
      });
      
      const isValid = await this.validateRecord(record as SpeedRecord);
      if (!isValid) {
        console.log('Record validation failed - skipping record creation');
        return;
      }

      // Generate signature
      const signature = await this.generateSignature(record);
      const signedRecord: SpeedRecord = { ...record, signature };

      // Always store record for complete legal coverage (including when stopped)
      await this.storeRecord(signedRecord);
      console.log('Speed record created:', {
        speed: signedRecord.speed,
        accuracy: signedRecord.accuracy,
        timestamp: new Date(signedRecord.timestamp).toISOString(),
        status: speed > 0 ? 'moving' : 'stopped'
      });
      
      // Always update previous record and last known speed
      this.previousRecord = signedRecord;
      this.lastKnownSpeed = speed;
      
      // Store last known speed for UI updates
      await AsyncStorage.setItem('last_known_speed', JSON.stringify({
        speed: speed,
        timestamp: Date.now()
      }));

    } catch (error) {
      console.error('Failed to process location update:', error);
    }
  }

  private async storeRecord(record: SpeedRecord): Promise<void> {
    try {
      const existingData = await AsyncStorage.getItem(STORAGE_KEY);
      const records: SpeedRecord[] = existingData ? JSON.parse(existingData) : [];
      
      records.push(record);

      // Keep only last 24 hours of data (more efficient cleanup for higher volume)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const filteredRecords = records.filter(r => r.timestamp > oneDayAgo);

      // Limit total records to prevent excessive storage (keep last 2880 records = 24h at 1/sec)
      const maxRecords = 2880; // 24 hours * 60 minutes * 2 (every 30 seconds average)
      const trimmedRecords = filteredRecords.slice(-maxRecords);

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedRecords));
      
    } catch (error) {
      console.error('Failed to store record:', error);
    }
  }

  async getRecords(startTime?: number, endTime?: number): Promise<SpeedRecord[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (!data) return [];

      const records: SpeedRecord[] = JSON.parse(data);
      
      if (startTime || endTime) {
        return records.filter(record => 
          (!startTime || record.timestamp >= startTime) &&
          (!endTime || record.timestamp <= endTime)
        );
      }

      return records;
    } catch (error) {
      console.error('Failed to get records:', error);
      return [];
    }
  }

  getTrackingStatus(): boolean {
    return this.isTracking;
  }

  async getLastKnownSpeed(): Promise<number> {
    try {
      const data = await AsyncStorage.getItem('last_known_speed');
      if (data) {
        const parsed = JSON.parse(data);
        // If the last update was more than 5 seconds ago, assume stopped
        if (Date.now() - parsed.timestamp > 5000) {
          return 0;
        }
        return parsed.speed || 0;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }
}

// Background task - commented out for Expo Go compatibility
// Uncomment when using a development build
/*
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error);
    return;
  }

  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    const locationService = LocationService.getInstance();
    
    for (const location of locations) {
      await locationService.processLocationUpdate(location);
    }
  }
});
*/

// Singleton instance
let instance: LocationServiceClass | null = null;

export const LocationService = {
  getInstance: (): LocationServiceClass => {
    if (!instance) {
      instance = new LocationServiceClass();
    }
    return instance;
  }
};

export default LocationService;