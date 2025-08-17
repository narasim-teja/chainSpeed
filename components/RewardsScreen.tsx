import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePrivy, getUserEmbeddedEthereumWallet } from '@privy-io/expo';
import { getXPService, UserXPStats, GiftCardOption, UserGiftCard } from '../services/XPService';
import { Colors } from '../constants/Colors';

interface RewardsScreenProps {
  navigation?: any;
}

export default function RewardsScreen({ navigation }: RewardsScreenProps) {
  const { user } = usePrivy();
  const account = getUserEmbeddedEthereumWallet(user);
  const authenticated = !!user;
  
  const [xpStats, setXpStats] = useState<UserXPStats>({
    totalXP: 0,
    lifetimeMiles: 0,
    safeMiles: 0,
    currentStreak: 0,
    driveToEarnEnabled: false
  });
  
  const [giftCardOptions] = useState<GiftCardOption[]>(getXPService().getGiftCardOptions());
  const [userGiftCards, setUserGiftCards] = useState<UserGiftCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGiftCard, setSelectedGiftCard] = useState<GiftCardOption | null>(null);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [showGiftCardModal, setShowGiftCardModal] = useState(false);
  const [redeemedCard, setRedeemedCard] = useState<UserGiftCard | null>(null);

  useEffect(() => {
    loadXPData();
    
    // Refresh data every 10 seconds
    const interval = setInterval(loadXPData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Set user address in XP service when available
  useEffect(() => {
    if (account?.address) {
      const xpService = getXPService();
      xpService.setUserAddress(account.address);
      console.log('🎯 Set user address in XP service:', account.address);
    }
  }, [account?.address]);

  const loadXPData = async () => {
    try {
      const xpService = getXPService();
      const [stats, giftCards] = await Promise.all([
        xpService.getUserXPStats(),
        xpService.getUserGiftCards()
      ]);
      
      setXpStats(stats);
      setUserGiftCards(giftCards);
    } catch (error) {
      console.error('Failed to load XP data:', error);
    }
  };

  const handleToggleDriveToEarn = async () => {
    if (!authenticated) {
      Alert.alert('Login Required', 'Please login to enable drive-to-earn rewards');
      return;
    }

    try {
      setLoading(true);
      const xpService = getXPService();
      const success = await xpService.toggleDriveToEarn(!xpStats.driveToEarnEnabled);
      
      if (success) {
        await loadXPData();
        Alert.alert(
          'Drive-to-Earn Updated',
          `Drive-to-earn has been ${!xpStats.driveToEarnEnabled ? 'enabled' : 'disabled'}. ${
            !xpStats.driveToEarnEnabled ? 'Start driving safely to earn XP!' : ''
          }`
        );
      } else {
        Alert.alert('Error', 'Failed to update drive-to-earn setting');
      }
    } catch (error) {
      console.error('Failed to toggle drive-to-earn:', error);
      Alert.alert('Error', 'Failed to update drive-to-earn setting');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemGiftCard = async () => {
    if (!selectedGiftCard) return;

    try {
      setLoading(true);
      const xpService = getXPService();
      const giftCard = await xpService.redeemGiftCard(selectedGiftCard.provider, selectedGiftCard.value);
      
      if (giftCard) {
        setRedeemedCard(giftCard);
        setShowRedeemModal(false);
        setShowGiftCardModal(true);
        await loadXPData(); // Refresh XP balance
      }
    } catch (error: any) {
      console.error('Failed to redeem gift card:', error);
      Alert.alert('Redemption Failed', error.message || 'Failed to redeem gift card');
    } finally {
      setLoading(false);
    }
  };

  const openRedeemModal = (option: GiftCardOption) => {
    setSelectedGiftCard(option);
    setShowRedeemModal(true);
  };

  const renderXPStats = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statCard}>
        <Ionicons name="star" size={24} color={Colors.light.tint} />
        <Text style={styles.statValue}>{xpStats.totalXP.toLocaleString()}</Text>
        <Text style={styles.statLabel}>Total XP</Text>
      </View>
      
      <View style={styles.statCard}>
        <Ionicons name="car" size={24} color="#4CAF50" />
        <Text style={styles.statValue}>{xpStats.safeMiles.toLocaleString()}</Text>
        <Text style={styles.statLabel}>Safe Miles</Text>
      </View>
      
      <View style={styles.statCard}>
        <Ionicons name="flame" size={24} color="#FF9800" />
        <Text style={styles.statValue}>{xpStats.currentStreak}</Text>
        <Text style={styles.statLabel}>Day Streak</Text>
      </View>
    </View>
  );

  const renderDriveToEarnToggle = () => (
    <View style={styles.toggleContainer}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleTitle}>Drive-to-Earn</Text>
        <Text style={styles.toggleSubtitle}>
          {xpStats.driveToEarnEnabled 
            ? 'Earning XP for safe driving' 
            : 'Enable to start earning XP rewards'
          }
        </Text>
      </View>
      
      <TouchableOpacity
        style={[
          styles.toggleButton,
          xpStats.driveToEarnEnabled ? styles.toggleEnabled : styles.toggleDisabled
        ]}
        onPress={handleToggleDriveToEarn}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons 
            name={xpStats.driveToEarnEnabled ? 'checkmark' : 'close'} 
            size={20} 
            color="#fff" 
          />
        )}
      </TouchableOpacity>
    </View>
  );

  const renderGiftCardGrid = () => (
    <View style={styles.giftCardContainer}>
      <Text style={styles.sectionTitle}>Redeem Rewards</Text>
      
      <View style={styles.giftCardGrid}>
        {giftCardOptions.map((option, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.giftCardOption,
              xpStats.totalXP < option.cost && styles.giftCardDisabled
            ]}
            onPress={() => openRedeemModal(option)}
            disabled={xpStats.totalXP < option.cost}
          >
            <View style={styles.giftCardHeader}>
              <Ionicons 
                name={option.provider === 'TARGET' ? 'storefront' : 'tv'} 
                size={24} 
                color={option.provider === 'TARGET' ? '#CC0000' : '#E50914'} 
              />
              <Text style={styles.giftCardProvider}>{option.provider}</Text>
            </View>
            
            <Text style={styles.giftCardValue}>${option.value}</Text>
            <Text style={styles.giftCardCost}>{option.cost.toLocaleString()} XP</Text>
            
            {xpStats.totalXP < option.cost && (
              <Text style={styles.insufficientXP}>
                Need {(option.cost - xpStats.totalXP).toLocaleString()} more XP
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderUserGiftCards = () => {
    if (userGiftCards.length === 0) return null;

    return (
      <View style={styles.userGiftCardsContainer}>
        <Text style={styles.sectionTitle}>Your Gift Cards</Text>
        
        {userGiftCards.map((card, index) => (
          <View key={index} style={styles.userGiftCard}>
            <View style={styles.giftCardInfo}>
              <Ionicons 
                name={card.provider === 'TARGET' ? 'storefront' : 'tv'} 
                size={20} 
                color={card.provider === 'TARGET' ? '#CC0000' : '#E50914'} 
              />
              <Text style={styles.giftCardText}>
                {card.provider} ${card.value} Gift Card
              </Text>
            </View>
            <Text style={styles.giftCardCode}>{card.code}</Text>
          </View>
        ))}
      </View>
    );
  };

  if (!authenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Ionicons name="lock-closed" size={64} color={Colors.light.tabIconDefault} />
          <Text style={styles.loginPrompt}>Login Required</Text>
          <Text style={styles.loginSubtext}>
            Please login to access drive-to-earn rewards
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Rewards</Text>
          <Text style={styles.subtitle}>Earn XP for safe driving</Text>
        </View>

        {renderXPStats()}
        {renderDriveToEarnToggle()}
        {renderGiftCardGrid()}
        {renderUserGiftCards()}

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>💡 How to earn XP:</Text>
          <Text style={styles.infoText}>• Drive safely (under 75 mph) to earn 1 XP per mile</Text>
          <Text style={styles.infoText}>• Maintain daily driving streaks for 5 XP</Text>
          <Text style={styles.infoText}>• Redeem XP for real gift cards</Text>
        </View>
      </ScrollView>

      {/* Redeem Confirmation Modal */}
      <Modal
        visible={showRedeemModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowRedeemModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Redeem Gift Card</Text>
            
            {selectedGiftCard && (
              <View style={styles.modalGiftCard}>
                <Ionicons 
                  name={selectedGiftCard.provider === 'TARGET' ? 'storefront' : 'tv'} 
                  size={32} 
                  color={selectedGiftCard.provider === 'TARGET' ? '#CC0000' : '#E50914'} 
                />
                <Text style={styles.modalGiftCardText}>
                  {selectedGiftCard.provider} ${selectedGiftCard.value}
                </Text>
                <Text style={styles.modalGiftCardCost}>
                  Cost: {selectedGiftCard.cost.toLocaleString()} XP
                </Text>
              </View>
            )}
            
            <Text style={styles.modalConfirmText}>
              Are you sure you want to redeem this gift card?
            </Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setShowRedeemModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.modalConfirmButton]}
                onPress={handleRedeemGiftCard}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmButtonText}>Redeem</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Gift Card Success Modal */}
      <Modal
        visible={showGiftCardModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowGiftCardModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Ionicons name="checkmark-circle" size={64} color="#4CAF50" />
            <Text style={styles.modalTitle}>Gift Card Redeemed!</Text>
            
            {redeemedCard && (
              <View style={styles.redeemedCardInfo}>
                <Text style={styles.redeemedCardText}>
                  {redeemedCard.provider} ${redeemedCard.value} Gift Card
                </Text>
                <Text style={styles.redeemedCardCode}>{redeemedCard.code}</Text>
                <Text style={styles.redeemedCardInstructions}>
                  Use this code at checkout or in the {redeemedCard.provider} app
                </Text>
              </View>
            )}
            
            <TouchableOpacity
              style={[styles.modalButton, styles.modalConfirmButton]}
              onPress={() => setShowGiftCardModal(false)}
            >
              <Text style={styles.modalConfirmButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#6c757d',
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 20,
    justifyContent: 'space-between',
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212529',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#6c757d',
    marginTop: 4,
  },
  toggleContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleInfo: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212529',
  },
  toggleSubtitle: {
    fontSize: 14,
    color: '#6c757d',
    marginTop: 4,
  },
  toggleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleEnabled: {
    backgroundColor: '#4CAF50',
  },
  toggleDisabled: {
    backgroundColor: '#dc3545',
  },
  giftCardContainer: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 16,
  },
  giftCardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  giftCardOption: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '48%',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  giftCardDisabled: {
    opacity: 0.6,
  },
  giftCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  giftCardProvider: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
    color: '#212529',
  },
  giftCardValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 4,
  },
  giftCardCost: {
    fontSize: 14,
    color: '#6c757d',
  },
  insufficientXP: {
    fontSize: 12,
    color: '#dc3545',
    marginTop: 4,
  },
  userGiftCardsContainer: {
    padding: 20,
  },
  userGiftCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  giftCardInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  giftCardText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    color: '#212529',
  },
  giftCardCode: {
    fontSize: 14,
    fontFamily: 'monospace',
    backgroundColor: '#f8f9fa',
    padding: 8,
    borderRadius: 6,
    color: '#495057',
  },
  infoSection: {
    padding: 20,
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#6c757d',
    marginBottom: 4,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loginPrompt: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212529',
    marginTop: 16,
    marginBottom: 8,
  },
  loginSubtext: {
    fontSize: 16,
    color: '#6c757d',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 16,
  },
  modalGiftCard: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalGiftCardText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212529',
    marginTop: 8,
  },
  modalGiftCardCost: {
    fontSize: 14,
    color: '#6c757d',
    marginTop: 4,
  },
  modalConfirmText: {
    fontSize: 16,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
  },
  modalCancelButton: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  modalConfirmButton: {
    backgroundColor: Colors.light.tint,
  },
  modalCancelText: {
    fontSize: 16,
    color: '#6c757d',
  },
  modalConfirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  redeemedCardInfo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  redeemedCardText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 8,
  },
  redeemedCardCode: {
    fontSize: 16,
    fontFamily: 'monospace',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    color: '#495057',
    marginBottom: 8,
  },
  redeemedCardInstructions: {
    fontSize: 14,
    color: '#6c757d',
    textAlign: 'center',
  },
});