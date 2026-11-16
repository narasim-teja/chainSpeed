import { Hono } from "hono";
import { p256 } from "@noble/curves/p256";
import { encodeAbiParameters, isAddress, keccak256, type Address, type Hex } from "viem";
import { AttestationError, verifyAttestation, type AttestEnvironment } from "./appAttest";
import { registrationClientDataHash } from "./binding";
import { fromBase64, fromHex, toHex } from "./bytes";
import type { ChallengeStore } from "./challenges";
import type { IdentityVerifier } from "./identity";
import type { RegistryClient } from "./registry";
import type { DeviceStore } from "./store";

export interface AppDeps {
  challenges: ChallengeStore;
  identity: IdentityVerifier;
  registry: RegistryClient;
  store: DeviceStore;
  attest: {
    appId: string;
    allowedEnvironments: AttestEnvironment[];
    rootCertificatePem: string;
    now?: () => Date;
  };
}

interface RegisterRequest {
  challenge: string;
  keyId: Uint8Array;
  keyIdBase64: string;
  attestation: Uint8Array;
  enclavePublicKey: Uint8Array;
  wallet: Address;
}

class BadRequest extends Error {}

function parseRegisterRequest(body: unknown): RegisterRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    const value = b[key];
    if (typeof value !== "string" || value.length === 0 || value.length > 16_384) {
      throw new BadRequest(`${key} is required`);
    }
    return value;
  };

  const challenge = str("challenge");
  if (fromBase64(challenge).length !== 32) throw new BadRequest("challenge must be 32 bytes");

  const keyIdBase64 = str("keyId");
  const keyId = fromBase64(keyIdBase64);
  if (keyId.length !== 32) throw new BadRequest("keyId must be 32 bytes");

  const attestation = fromBase64(str("attestation"));

  let enclavePublicKey: Uint8Array;
  try {
    enclavePublicKey = fromHex(str("enclavePublicKey"));
    if (enclavePublicKey.length !== 65 || enclavePublicKey[0] !== 0x04) throw new Error();
    p256.ProjectivePoint.fromHex(enclavePublicKey).assertValidity(); // on the curve
  } catch (e) {
    if (e instanceof BadRequest) throw e;
    throw new BadRequest("enclavePublicKey must be an uncompressed P-256 point");
  }

  const wallet = str("wallet");
  if (!isAddress(wallet, { strict: false })) throw new BadRequest("wallet must be an address");

  return {
    challenge,
    keyId,
    keyIdBase64,
    attestation,
    enclavePublicKey,
    wallet: wallet.toLowerCase() as Address,
  };
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/v1/challenge", (c) => c.json(deps.challenges.issue()));

  /**
   * Registers a device's Secure Enclave key for a wallet. Every step must pass:
   * a fresh challenge, a valid Privy identity, ownership of the wallet, and an
   * App Attest attestation that commits to (challenge, enclave key, wallet).
   */
  app.post("/v1/devices/register", async (c) => {
    const identityToken = c.req.header("privy-id-token");
    if (!identityToken) return c.json({ error: "missing_identity_token" }, 401);

    let req: RegisterRequest;
    try {
      req = parseRegisterRequest(await c.req.json());
    } catch (e) {
      const message = e instanceof BadRequest ? e.message : "body must be JSON";
      return c.json({ error: "invalid_request", message }, 400);
    }

    // Consumed before anything else can fail, so a challenge is never usable twice.
    if (!deps.challenges.consume(req.challenge)) return c.json({ error: "invalid_challenge" }, 400);

    let identity;
    try {
      identity = await deps.identity.verify(identityToken);
    } catch {
      return c.json({ error: "invalid_identity_token" }, 401);
    }
    if (!identity.walletAddresses.includes(req.wallet)) return c.json({ error: "wallet_not_owned" }, 403);

    let attested;
    try {
      attested = await verifyAttestation({
        attestation: req.attestation,
        keyId: req.keyId,
        clientDataHash: registrationClientDataHash(fromBase64(req.challenge), req.enclavePublicKey, req.wallet),
        appId: deps.attest.appId,
        allowedEnvironments: deps.attest.allowedEnvironments,
        rootCertificatePem: deps.attest.rootCertificatePem,
        now: deps.attest.now?.(),
      });
    } catch (e) {
      if (e instanceof AttestationError) return c.json({ error: "attestation_invalid", reason: e.code }, 400);
      throw e;
    }

    const enclaveHex = toHex(req.enclavePublicKey);
    if (deps.store.isKeyUsed(req.keyIdBase64, enclaveHex)) return c.json({ error: "key_already_registered" }, 409);

    const qx = toHex(req.enclavePublicKey.slice(1, 33)) as Hex;
    const qy = toHex(req.enclavePublicKey.slice(33, 65)) as Hex;
    const keyHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [qx, qy]));

    let txHash: Hex;
    try {
      txHash = await deps.registry.registerDevice(req.wallet, qx, qy);
    } catch (e) {
      console.error("registerDevice failed", e);
      return c.json({ error: "chain_error" }, 502);
    }

    deps.store.save({
      userId: identity.userId,
      wallet: req.wallet,
      appAttestKeyId: req.keyIdBase64,
      appAttestPublicKey: toHex(attested.publicKey),
      receipt: attested.receipt,
      environment: attested.environment,
      enclavePublicKey: enclaveHex,
      keyHash,
      txHash,
    });

    return c.json({ wallet: req.wallet, keyHash, txHash, environment: attested.environment }, 201);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
