import Constants from "expo-constants";
import { Stack } from "expo-router";
import { PrivyProvider } from "@privy-io/expo";
import { CURRENT_CHAIN_CONFIG } from "../constants/Blockchain";
import { PrivyElements } from "@privy-io/expo/ui";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";

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
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="rewards" options={{ headerShown: false }} />
      </Stack>
      <PrivyElements />
    </PrivyProvider>
  );
}
