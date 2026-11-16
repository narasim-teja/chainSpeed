import { ethers } from "hardhat";
import { p256 } from "@noble/curves/p256";

// P-256 group order, for building a deliberately high-s (malleable) signature.
export const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

export type Input = {
  seq: bigint;
  prevRoot: string;
  merkleRoot: string;
  startTime: bigint;
  endTime: bigint;
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  distanceMeters: number;
  recordCount: number;
};

/** A stand-in for a phone's Secure Enclave key. */
export function makeEnclaveKey() {
  const priv = p256.utils.randomPrivateKey();
  const pub = p256.getPublicKey(priv, false); // 0x04 || x || y
  return {
    priv,
    qx: ethers.hexlify(pub.slice(1, 33)),
    qy: ethers.hexlify(pub.slice(33, 65)),
  };
}
export type EnclaveKey = ReturnType<typeof makeEnclaveKey>;

export const INPUT_TUPLE =
  "tuple(uint64 seq,bytes32 prevRoot,bytes32 merkleRoot,uint64 startTime,uint64 endTime,uint8 avgSpeed,uint8 maxSpeed,uint8 minSpeed,uint16 distanceMeters,uint16 recordCount)";

/** Computes the digest exactly as the app will, independently of the contract. */
export async function clientDigest(registry: { getAddress(): Promise<string> }, device: string, cp: Input) {
  const { chainId } = await ethers.provider.getNetwork();
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "address", INPUT_TUPLE],
      [
        ethers.keccak256(ethers.toUtf8Bytes("ChainSpeed.Checkpoint.v2")),
        chainId,
        await registry.getAddress(),
        device,
        cp,
      ]
    )
  );
}

/** Signs like the enclave: ECDSA P-256 over the 32-byte digest, low-s normalized. */
export async function sign(registry: { getAddress(): Promise<string> }, device: string, cp: Input, key: EnclaveKey) {
  const digest = await clientDigest(registry, device, cp);
  const sig = p256.sign(ethers.getBytes(digest), key.priv, { lowS: true, prehash: false });
  return { r: ethers.toBeHex(sig.r, 32), s: ethers.toBeHex(sig.s, 32) };
}

