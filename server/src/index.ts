import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hederaTestnet } from "viem/chains";
import type { Address, Hex } from "viem";
import { createApp } from "./app";
import type { AttestEnvironment } from "./appAttest";
import { ChallengeStore } from "./challenges";
import { PrivyIdentityVerifier } from "./identity";
import { ViemRegistryClient } from "./registry";
import { DeviceStore } from "./store";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see server/.env.example)`);
  return value;
}

const allowedEnvironments = (process.env.ATTEST_ENVIRONMENTS ?? "production")
  .split(",")
  .map((e) => e.trim()) as AttestEnvironment[];

const dbPath = process.env.DB_PATH ?? "./data/devices.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });

const app = createApp({
  challenges: new ChallengeStore(),
  identity: new PrivyIdentityVerifier(required("PRIVY_APP_ID"), required("PRIVY_APP_SECRET")),
  registry: new ViemRegistryClient(
    required("REGISTRY_ADDRESS") as Address,
    required("REGISTRAR_PRIVATE_KEY") as Hex,
    hederaTestnet,
    process.env.RPC_URL ?? "https://testnet.hashio.io/api"
  ),
  store: new DeviceStore(dbPath),
  attest: {
    appId: required("APP_ID"),
    allowedEnvironments,
    rootCertificatePem: readFileSync(join(import.meta.dir, "..", "certs", "apple-app-attestation-root-ca.pem"), "utf8"),
  },
});

const port = Number(process.env.PORT ?? 8787);
console.log(`ChainSpeed registrar listening on :${port} (App Attest environments: ${allowedEnvironments.join(", ")})`);

export default { port, fetch: app.fetch };
