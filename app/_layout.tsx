import Constants from "expo-constants";
import { Stack } from "expo-router";
import { PrivyProvider } from "@privy-io/expo";
import { PrivyElements } from "@privy-io/expo/ui";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { FLOW_TESTNET_CONFIG } from "../constants/Blockchain";

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
          id: FLOW_TESTNET_CONFIG.id,
          name: FLOW_TESTNET_CONFIG.name,
          network: FLOW_TESTNET_CONFIG.name.toLowerCase().replace(/\s+/g, '-'),
          nativeCurrency: FLOW_TESTNET_CONFIG.nativeCurrency,
          rpcUrls: {
            default: {
              http: [FLOW_TESTNET_CONFIG.rpcUrl],
            },
          },
          blockExplorers: {
            default: {
              name: 'Hedera Testnet Explorer',
              url: FLOW_TESTNET_CONFIG.blockExplorer,
            },
          },
        },
      ]}
    >
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="rewards" options={{ headerShown: false }} />
      </Stack>
      <PrivyElements />
    </PrivyProvider>
  );
}
