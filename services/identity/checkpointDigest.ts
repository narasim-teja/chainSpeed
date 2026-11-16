import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from 'viem';

/** Must match SpeedRegistry.CHECKPOINT_TYPEHASH. */
export const CHECKPOINT_TYPEHASH = keccak256(toBytes('ChainSpeed.Checkpoint.v2'));

/** Mirrors SpeedRegistry.CheckpointInput, field for field. */
export interface CheckpointInput {
  seq: bigint;
  prevRoot: Hex;
  merkleRoot: Hex;
  startTime: bigint;
  endTime: bigint;
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  distanceMeters: number;
  recordCount: number;
}

const CHECKPOINT_INPUT_COMPONENTS = [
  { name: 'seq', type: 'uint64' },
  { name: 'prevRoot', type: 'bytes32' },
  { name: 'merkleRoot', type: 'bytes32' },
  { name: 'startTime', type: 'uint64' },
  { name: 'endTime', type: 'uint64' },
  { name: 'avgSpeed', type: 'uint8' },
  { name: 'maxSpeed', type: 'uint8' },
  { name: 'minSpeed', type: 'uint8' },
  { name: 'distanceMeters', type: 'uint16' },
  { name: 'recordCount', type: 'uint16' },
] as const;

/**
 * The digest the Secure Enclave signs. Identical to SpeedRegistry.checkpointDigest:
 * keccak256(abi.encode(TYPEHASH, chainId, registry, device, input)).
 */
export function checkpointDigest(chainId: number | bigint, registry: Address, device: Address, input: CheckpointInput): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'tuple', components: CHECKPOINT_INPUT_COMPONENTS },
      ],
      [CHECKPOINT_TYPEHASH, BigInt(chainId), registry, device, input]
    )
  );
}
