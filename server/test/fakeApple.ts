/**
 * A stand-in for Apple's App Attest service. It mints its own root and
 * intermediate CAs (P-384, like Apple's) and issues attestation objects with
 * the same structure a real device produces, so each verification step can be
 * exercised, including the failures. A real attestation from a physical
 * iPhone is checked separately in appAttest.test.ts.
 */
import { x509 } from "../src/x509";
import { encode } from "cbor-x";
import { concat, sha256 } from "../src/bytes";
import type { AttestEnvironment } from "../src/appAttest";


const P384 = { name: "ECDSA", namedCurve: "P-384", hash: "SHA-384" } as const;
const P256 = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

const DAY = 24 * 60 * 60 * 1000;
export const NOW = new Date("2026-11-16T12:00:00Z");

export interface FakeAppleCa {
  rootPem: string;
  root: x509.X509Certificate;
  intermediate: x509.X509Certificate;
  intermediateKeys: CryptoKeyPair;
}

export async function makeFakeAppleCa(name = "Fake App Attestation Root CA"): Promise<FakeAppleCa> {
  const rootKeys = (await crypto.subtle.generateKey(P384, true, ["sign", "verify"])) as CryptoKeyPair;
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${name}`,
    notBefore: new Date(NOW.getTime() - 365 * DAY),
    notAfter: new Date(NOW.getTime() + 365 * DAY),
    keys: rootKeys,
    signingAlgorithm: P384,
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });

  const intermediateKeys = (await crypto.subtle.generateKey(P384, true, ["sign", "verify"])) as CryptoKeyPair;
  const intermediate = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=Fake App Attestation CA 1",
    issuer: root.subject,
    notBefore: new Date(NOW.getTime() - 30 * DAY),
    notAfter: new Date(NOW.getTime() + 30 * DAY),
    signingKey: rootKeys.privateKey,
    publicKey: intermediateKeys.publicKey,
    signingAlgorithm: P384,
    extensions: [new x509.BasicConstraintsExtension(true, 0, true)],
  });

  return { rootPem: root.toString("pem"), root, intermediate, intermediateKeys };
}

export interface AttestationOptions {
  clientDataHash: Uint8Array;
  appId: string;
  environment?: AttestEnvironment;
  counter?: number;
  /** Override the credential ID in authData (defaults to the real keyId). */
  credentialId?: Uint8Array;
  /** Override the nonce placed in the certificate (defaults to the correct one). */
  nonce?: Uint8Array;
  leafNotAfter?: Date;
  fmt?: string;
}

const AAGUIDS: Record<AttestEnvironment, string> = {
  production: "appattest\0\0\0\0\0\0\0",
  development: "appattestdevelop",
};

function u16(n: number) {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}
function u32(n: number) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

export async function makeAttestation(ca: FakeAppleCa, opts: AttestationOptions) {
  const leafKeys = (await crypto.subtle.generateKey(P256, true, ["sign", "verify"])) as CryptoKeyPair;
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", leafKeys.publicKey));
  const keyId = sha256(rawPublicKey);
  const credentialId = opts.credentialId ?? keyId;

  const authData = concat(
    sha256(new TextEncoder().encode(opts.appId)),
    new Uint8Array([0x40]), // flags: attested credential data included
    u32(opts.counter ?? 0),
    new TextEncoder().encode(AAGUIDS[opts.environment ?? "development"]),
    u16(credentialId.length),
    credentialId,
    new Uint8Array(encode({ 1: 2, 3: -7 })) // COSE key stub; the verifier reads the key from the certificate
  );

  const nonce = opts.nonce ?? sha256(concat(authData, opts.clientDataHash));
  const nonceExtension = concat(new Uint8Array([0x30, 36, 0xa1, 34, 0x04, 32]), nonce);

  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: "03",
    subject: `CN=${Buffer.from(keyId).toString("hex")}`,
    issuer: ca.intermediate.subject,
    notBefore: new Date(NOW.getTime() - DAY),
    notAfter: opts.leafNotAfter ?? new Date(NOW.getTime() + 2 * DAY),
    signingKey: ca.intermediateKeys.privateKey,
    publicKey: leafKeys.publicKey,
    signingAlgorithm: P384,
    extensions: [new x509.Extension("1.2.840.113635.100.8.2", false, nonceExtension)],
  });

  const attestation = new Uint8Array(
    encode({
      fmt: opts.fmt ?? "apple-appattest",
      attStmt: {
        x5c: [new Uint8Array(leaf.rawData), new Uint8Array(ca.intermediate.rawData)],
        receipt: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      },
      authData,
    })
  );

  return { attestation, keyId, rawPublicKey };
}
