import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { p256 } from "@noble/curves/p256";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { createApp } from "../src/app";
import { registrationClientDataHash } from "../src/binding";
import { fromBase64, fromHex, toHex } from "../src/bytes";
import { ChallengeStore } from "../src/challenges";
import type { IdentityVerifier } from "../src/identity";
import type { RegistryClient } from "../src/registry";
import { DeviceStore } from "../src/store";
import { makeAttestation, makeFakeAppleCa, NOW, type FakeAppleCa } from "./fakeApple";

const APP_ID = "TEAMID1234.com.narasimha.chainspeed";
const USER_WALLET = "0x1111111111111111111111111111111111111111" as Address;
const SOMEONE_ELSES_WALLET = "0x2222222222222222222222222222222222222222" as Address;
const GOOD_TOKEN = "valid-privy-identity-token";

class FakeIdentity implements IdentityVerifier {
  async verify(token: string) {
    if (token !== GOOD_TOKEN) throw new Error("invalid token");
    return { userId: "did:privy:user-1", walletAddresses: [USER_WALLET] };
  }
}

class FakeRegistry implements RegistryClient {
  calls: { device: Address; qx: Hex; qy: Hex }[] = [];
  fail = false;
  async registerDevice(device: Address, qx: Hex, qy: Hex) {
    if (this.fail) throw new Error("rpc down");
    this.calls.push({ device, qx, qy });
    return "0xabc" as Hex;
  }
}

function makeEnclaveKey(): Uint8Array {
  return p256.getPublicKey(p256.utils.randomPrivateKey(), false); // 0x04 ‖ x ‖ y
}

let ca: FakeAppleCa;
beforeAll(async () => {
  ca = await makeFakeAppleCa();
});

let registry: FakeRegistry;
let store: DeviceStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  registry = new FakeRegistry();
  store = new DeviceStore();
  app = createApp({
    challenges: new ChallengeStore(),
    identity: new FakeIdentity(),
    registry,
    store,
    attest: { appId: APP_ID, allowedEnvironments: ["development"], rootCertificatePem: ca.rootPem, now: () => NOW },
  });
});

async function getChallenge(): Promise<string> {
  const res = await app.request("/v1/challenge", { method: "POST" });
  return ((await res.json()) as { challenge: string }).challenge;
}

/**
 * Builds a registration the way the app will: attest over (challenge, enclave key, wallet).
 * `attestFor` lets a test attest one thing and submit another.
 */
async function buildRegistration(opts: {
  challenge?: string;
  enclaveKey?: Uint8Array;
  wallet?: Address;
  attestFor?: { enclaveKey?: Uint8Array; wallet?: Address };
} = {}) {
  const challenge = opts.challenge ?? (await getChallenge());
  const enclaveKey = opts.enclaveKey ?? makeEnclaveKey();
  const wallet = opts.wallet ?? USER_WALLET;
  const clientDataHash = registrationClientDataHash(
    fromBase64(challenge),
    opts.attestFor?.enclaveKey ?? enclaveKey,
    opts.attestFor?.wallet ?? wallet
  );
  const { attestation, keyId } = await makeAttestation(ca, { clientDataHash, appId: APP_ID });
  return {
    challenge,
    keyId: Buffer.from(keyId).toString("base64"),
    attestation: Buffer.from(attestation).toString("base64"),
    enclavePublicKey: toHex(enclaveKey),
    wallet,
  };
}

function register(body: unknown, token: string | null = GOOD_TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["privy-id-token"] = token;
  return app.request("/v1/devices/register", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /v1/devices/register", () => {
  test("registers an attested enclave key for the user's wallet on chain", async () => {
    const body = await buildRegistration();
    const res = await register(body);
    expect(res.status).toBe(201);

    const enclaveKey = fromHex(body.enclavePublicKey);
    const qx = toHex(enclaveKey.slice(1, 33));
    const qy = toHex(enclaveKey.slice(33, 65));
    expect(registry.calls).toEqual([{ device: USER_WALLET, qx, qy }]);

    const json = (await res.json()) as { keyHash: string; environment: string };
    // Same keyHash the contract records: keccak256(abi.encode(qx, qy)).
    expect(json.keyHash).toBe(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [qx, qy])));
    expect(json.environment).toBe("development");
    expect(store.latestForWallet(USER_WALLET)?.user_id).toBe("did:privy:user-1");
  });

  test("binding: an attestation for one enclave key cannot register a different key", async () => {
    const body = await buildRegistration({ attestFor: { enclaveKey: makeEnclaveKey() } });
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "attestation_invalid", reason: "nonce_mismatch" });
    expect(registry.calls).toHaveLength(0);
  });

  test("binding: an attestation for one wallet cannot register to another wallet", async () => {
    const body = await buildRegistration({ attestFor: { wallet: SOMEONE_ELSES_WALLET } });
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "attestation_invalid", reason: "nonce_mismatch" });
  });

  test("a user cannot register a key to a wallet they do not own", async () => {
    const body = await buildRegistration({ wallet: SOMEONE_ELSES_WALLET });
    const res = await register(body);
    expect(res.status).toBe(403);
    expect(registry.calls).toHaveLength(0);
  });

  test("challenges are single use", async () => {
    const body = await buildRegistration();
    expect((await register(body)).status).toBe(201);
    const replay = await register(body);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_challenge" });
  });

  test("rejects a challenge the server never issued", async () => {
    const forged = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const res = await register(await buildRegistration({ challenge: forged }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_challenge" });
  });

  test("rejects an expired challenge", async () => {
    let clock = 0;
    const challenges = new ChallengeStore(1000, () => clock);
    const issued = challenges.issue();
    clock = 2000;
    expect(challenges.consume(issued.challenge)).toBe(false);
  });

  test("requires a valid Privy identity token", async () => {
    expect((await register(await buildRegistration(), null)).status).toBe(401);
    expect((await register(await buildRegistration(), "forged-token")).status).toBe(401);
  });

  test("an enclave key can only be registered once", async () => {
    const enclaveKey = makeEnclaveKey();
    expect((await register(await buildRegistration({ enclaveKey }))).status).toBe(201);
    const again = await register(await buildRegistration({ enclaveKey }));
    expect(again.status).toBe(409);
  });

  test("does not record a device if the chain transaction fails", async () => {
    registry.fail = true;
    const res = await register(await buildRegistration());
    expect(res.status).toBe(502);
    expect(store.latestForWallet(USER_WALLET)).toBeNull();
  });

  test("rejects malformed requests before touching the challenge", async () => {
    const body = await buildRegistration();
    const bad = await register({ ...body, enclavePublicKey: "0x04" + "00".repeat(64) }); // not on the curve
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_request");
    // The challenge was not consumed by the malformed request, so the valid one still works.
    expect((await register(body)).status).toBe(201);
  });
});
