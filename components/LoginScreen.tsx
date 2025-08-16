import { Button, Text, View } from "react-native";
import { useLogin } from "@privy-io/expo/ui";
import { useState } from "react";

export default function LoginScreen() {
  const [error, setError] = useState("");
  const { login } = useLogin();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 20,
        marginHorizontal: 20,
      }}
    >
      <Text style={{ fontSize: 24, fontWeight: "bold", textAlign: "center" }}>
        Welcome to ChainSpeed
      </Text>
      
      <Text style={{ fontSize: 16, textAlign: "center", color: "#666" }}>
        Sign in to get started
      </Text>

      <Button
        title="Sign In"
        onPress={() => {
          login({ loginMethods: ["email"] })
            .then((session) => {
              console.log("User logged in", session.user);
            })
            .catch((err) => {
              setError(err.message || "Login failed");
            });
        }}
      />

      {error && (
        <Text style={{ color: "red", textAlign: "center", marginTop: 10 }}>
          {error}
        </Text>
      )}
    </View>
  );
}
