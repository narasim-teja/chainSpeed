import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AttestationError, verifyAttestation, type VerifyAttestationInput } from "../src/appAttest";
import { fromBase64, sha256 } from "../src/bytes";
import { makeAttestation, makeFakeAppleCa, NOW, type FakeAppleCa } from "./fakeApple";

const APP_ID = "TEAMID1234.com.narasimha.chainspeed";
const clientDataHash = sha256(new TextEncoder().encode("challenge ‖ enclave key ‖ wallet"));

let ca: FakeAppleCa;
beforeAll(async () => {
  ca = await makeFakeAppleCa();
});

async function verify(overrides: Partial<VerifyAttestationInput> & { attestation: Uint8Array; keyId: Uint8Array }) {
  return verifyAttestation({
    clientDataHash,
    appId: APP_ID,
    allowedEnvironments: ["development", "production"],
    rootCertificatePem: ca.rootPem,
    now: NOW,
    ...overrides,
  });
}

async function expectCode(promise: Promise<unknown>, code: AttestationError["code"]) {
  const error = await promise.then(
    () => null,
    (e) => e
  );
  expect(error).toBeInstanceOf(AttestationError);
  expect((error as AttestationError).code).toBe(code);
}

describe("App Attest verification", () => {
  test("accepts a well-formed attestation and returns the attested key", async () => {
    const { attestation, keyId, rawPublicKey } = await makeAttestation(ca, { clientDataHash, appId: APP_ID });
    const result = await verify({ attestation, keyId });
    expect(result.environment).toBe("development");
    expect(result.publicKey).toEqual(rawPublicKey);
  });

  test("step 1: rejects a chain from a different root (an attacker's own CA)", async () => {
    const attackerCa = await makeFakeAppleCa("Attacker Root CA");
    const { attestation, keyId } = await makeAttestation(attackerCa, { clientDataHash, appId: APP_ID });
    await expectCode(verify({ attestation, keyId }), "untrusted_chain");
  });

  test("step 1: rejects an expired credential certificate", async () => {
    const { attestation, keyId } = await makeAttestation(ca, {
      clientDataHash,
      appId: APP_ID,
      leafNotAfter: new Date(NOW.getTime() - 1000),
    });
    await expectCode(verify({ attestation, keyId }), "untrusted_chain");
  });

  test("steps 2-4: rejects an attestation made for different client data (wrong challenge, key or wallet)", async () => {
    const { attestation, keyId } = await makeAttestation(ca, { clientDataHash, appId: APP_ID });
    const other = sha256(new TextEncoder().encode("a different wallet"));
    await expectCode(verify({ attestation, keyId, clientDataHash: other }), "nonce_mismatch");
  });

  test("steps 2-4: rejects a certificate whose nonce does not match", async () => {
    const { attestation, keyId } = await makeAttestation(ca, {
      clientDataHash,
      appId: APP_ID,
      nonce: new Uint8Array(32),
    });
    await expectCode(verify({ attestation, keyId }), "nonce_mismatch");
  });

  test("step 5: rejects a keyId that is not the attested key", async () => {
    const { attestation } = await makeAttestation(ca, { clientDataHash, appId: APP_ID });
    await expectCode(verify({ attestation, keyId: new Uint8Array(32).fill(7) }), "key_id_mismatch");
  });

  test("step 6: rejects an attestation for a different app", async () => {
    const { attestation, keyId } = await makeAttestation(ca, {
      clientDataHash,
      appId: "OTHERTEAM.com.someone.else",
    });
    await expectCode(verify({ attestation, keyId }), "app_id_mismatch");
  });

  test("step 7: rejects a non-zero counter", async () => {
    const { attestation, keyId } = await makeAttestation(ca, { clientDataHash, appId: APP_ID, counter: 1 });
    await expectCode(verify({ attestation, keyId }), "counter_not_zero");
  });

  test("step 8: a production-only server rejects development attestations", async () => {
    const { attestation, keyId } = await makeAttestation(ca, { clientDataHash, appId: APP_ID });
    await expectCode(verify({ attestation, keyId, allowedEnvironments: ["production"] }), "environment_not_allowed");
  });

  test("step 9: rejects a credential ID that differs from keyId", async () => {
    const { attestation, keyId } = await makeAttestation(ca, {
      clientDataHash,
      appId: APP_ID,
      credentialId: new Uint8Array(32).fill(9),
    });
    await expectCode(verify({ attestation, keyId }), "key_id_mismatch");
  });

  test("rejects other attestation formats and garbage", async () => {
    const { attestation, keyId } = await makeAttestation(ca, { clientDataHash, appId: APP_ID, fmt: "packed" });
    await expectCode(verify({ attestation, keyId }), "malformed");
    await expectCode(verify({ attestation: new Uint8Array([1, 2, 3]), keyId }), "malformed");
  });
});

/**
 * A real attestation captured from a physical iPhone, verified against Apple's
 * actual root. Capture one with the app's debug export and save it as
 * test/fixtures/real-attestation.json:
 *   { "appId", "keyId", "attestation", "clientDataHash", "capturedAt" }  (binary fields base64)
 */
const fixturePath = join(import.meta.dir, "fixtures", "real-attestation.json");
describe.skipIf(!existsSync(fixturePath))("real device attestation", () => {
  test("verifies against Apple's App Attestation root", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const result = await verifyAttestation({
      attestation: fromBase64(fixture.attestation),
      keyId: fromBase64(fixture.keyId),
      clientDataHash: fromBase64(fixture.clientDataHash),
      appId: fixture.appId,
      allowedEnvironments: ["development", "production"],
      rootCertificatePem: readFileSync(join(import.meta.dir, "..", "certs", "apple-app-attestation-root-ca.pem"), "utf8"),
      now: new Date(fixture.capturedAt), // leaf certificates are short-lived
    });
    expect(result.publicKey.length).toBe(65);
  });
});
