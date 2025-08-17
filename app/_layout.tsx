import Constants from "expo-constants";
import { Tabs } from "expo-router";
import { PrivyProvider } from "@privy-io/expo";
import { CURRENT_CHAIN_CONFIG } from "../constants/Blockchain";
import { PrivyElements } from "@privy-io/expo/ui";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Ionicons } from '@expo/vector-icons';

export default function RootLayout() {
  useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  return (
    <PrivyProvider
      appId={Constants.expoConfig?.extra?.privyAppId}
      clientId={Constants.expoConfig?.extra?.privyClientId}
      supportedChains={[
        {
          id: CURRENT_CHAIN_CONFIG.id,
          name: CURRENT_CHAIN_CONFIG.name,
          network: CURRENT_CHAIN_CONFIG.name.toLowerCase().replace(/\s+/g, '-'),
          nativeCurrency: CURRENT_CHAIN_CONFIG.nativeCurrency,
          rpcUrls: {
            default: {
              http: [CURRENT_CHAIN_CONFIG.rpcUrl],
            },
          },
          blockExplorers: {
            default: {
              name: `${CURRENT_CHAIN_CONFIG.displayName} Explorer`,
              url: CURRENT_CHAIN_CONFIG.blockExplorer,
            },
          },
        },
      ]}
    >
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#4CAF50',
          tabBarInactiveTintColor: '#666',
          tabBarStyle: {
            backgroundColor: 'white',
            borderTopWidth: 1,
            borderTopColor: '#f0f0f0',
            height: 90,
            paddingBottom: 20,
            paddingTop: 10,
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '500',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Track',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="speedometer" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="rewards"
          options={{
            title: 'Rewards',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="gift" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
      <PrivyElements />
    </PrivyProvider>
  );
}
