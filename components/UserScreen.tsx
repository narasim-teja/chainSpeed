import React, { useState, useCallback, useEffect } from "react";
import { Text, View, Button, ScrollView, StyleSheet } from "react-native";

import {
  usePrivy,
  useEmbeddedEthereumWallet,
  getUserEmbeddedEthereumWallet,
  PrivyEmbeddedWalletProvider,
} from "@privy-io/expo";

const getMainIdentifier = (account: any) => {
  if (account.type === "phone") return account.phoneNumber;
  if (account.type === "email") return account.address;
  if (account.type === "wallet") return account.address;
  if (account.type === "twitter_oauth" || account.type === "tiktok_oauth") return account.username;
  if (account.type === "custom_auth") return account.custom_user_id;
  return account.type;
};

export const UserScreen = () => {
  const [signedMessages, setSignedMessages] = useState<string[]>([]);
  const { logout, user } = usePrivy();
  const { wallets, create } = useEmbeddedEthereumWallet();
  const account = getUserEmbeddedEthereumWallet(user);

  // Auto-create wallet for new users
  useEffect(() => {
    if (user && !account) {
      console.log("New user detected, creating wallet automatically...");
      create();
    }
  }, [user, account, create]);

  const signMessage = useCallback(
    async (provider: PrivyEmbeddedWalletProvider) => {
      try {
        const message = `ChainSpeed - Signed at ${new Date().toISOString()}`;
        const signature = await provider.request({
          method: "personal_sign",
          params: [message, account?.address],
        });
        if (signature) {
          setSignedMessages((prev) => [...prev, `${message}: ${signature}`]);
        }
      } catch (e) {
        console.error("Failed to sign message:", e);
      }
    },
    [account?.address]
  );

  if (!user) {
    return null;
  }

  const primaryAccount = user.linked_accounts.find(acc => 
    acc.type === "email" || acc.type === "phone" || acc.type === "google_oauth"
  ) || user.linked_accounts[0];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.welcomeText}>Welcome to ChainSpeed!</Text>
        
        {/* User Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.userInfo}>
            {getMainIdentifier(primaryAccount)}
          </Text>
        </View>

        {/* Wallet Info */}
        {account?.address && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Wallet Address</Text>
            <Text style={styles.walletAddress}>{account.address}</Text>
          </View>
        )}

        {/* Sign Message */}
        <View style={styles.section}>
          <Button
            title="Sign Message"
            onPress={async () => {
              if (wallets.length > 0) {
                signMessage(await wallets[0].getProvider());
              }
            }}
            disabled={!account || wallets.length === 0}
          />
          
          {signedMessages.length > 0 && (
            <>
              <Text style={styles.messagesTitle}>Signed Messages:</Text>
              {signedMessages.map((message, index) => (
                <Text key={index} style={styles.signedMessage}>
                  {message}
                </Text>
              ))}
            </>
          )}
        </View>

        {/* Logout */}
        <View style={styles.logoutSection}>
          <Button title="Logout" onPress={logout} color="#ff4444" />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 20,
    gap: 20,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  section: {
    backgroundColor: "white",
    padding: 15,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  userInfo: {
    fontSize: 14,
    color: "#666",
  },
  walletAddress: {
    fontSize: 12,
    color: "#666",
    fontFamily: "monospace",
  },
  messagesTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginTop: 15,
    marginBottom: 10,
    color: "#333",
  },
  signedMessage: {
    fontSize: 10,
    color: "#666",
    fontFamily: "monospace",
    marginBottom: 5,
    padding: 5,
    backgroundColor: "#f9f9f9",
    borderRadius: 4,
  },
  logoutSection: {
    marginTop: 20,
    marginBottom: 40,
  },
});
