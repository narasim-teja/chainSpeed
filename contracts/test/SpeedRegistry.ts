import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { p256 } from "@noble/curves/p256";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { SpeedRegistry } from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";

// P-256 group order, for building a deliberately high-s (malleable) signature.
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

type Input = {
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
function makeEnclaveKey() {
  const priv = p256.utils.randomPrivateKey();
  const pub = p256.getPublicKey(priv, false); // 0x04 || x || y
  return {
    priv,
    qx: ethers.hexlify(pub.slice(1, 33)),
    qy: ethers.hexlify(pub.slice(33, 65)),
  };
}
type EnclaveKey = ReturnType<typeof makeEnclaveKey>;

const INPUT_TUPLE =
  "tuple(uint64 seq,bytes32 prevRoot,bytes32 merkleRoot,uint64 startTime,uint64 endTime,uint8 avgSpeed,uint8 maxSpeed,uint8 minSpeed,uint16 distanceMeters,uint16 recordCount)";

/** Computes the digest exactly as the app will, independently of the contract. */
async function clientDigest(registry: SpeedRegistry, device: string, cp: Input) {
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
async function sign(registry: SpeedRegistry, device: string, cp: Input, key: EnclaveKey) {
  const digest = await clientDigest(registry, device, cp);
  const sig = p256.sign(ethers.getBytes(digest), key.priv, { lowS: true, prehash: false });
  return { r: ethers.toBeHex(sig.r, 32), s: ethers.toBeHex(sig.s, 32) };
}

describe("SpeedRegistry v2", function () {
  let registry: SpeedRegistry;
  let owner: HardhatEthersSigner;
  let registrar: HardhatEthersSigner;
  let wallet: HardhatEthersSigner; // the user's Privy wallet
  let other: HardhatEthersSigner; // an attacker or a relayer
  let key: EnclaveKey;
  let rootCounter = 0;

  const root = () => ethers.keccak256(ethers.toUtf8Bytes(`root-${rootCounter++}`));

  /**
   * A valid 30-second checkpoint chained to `wallet`'s last one. It starts where the
   * previous window ended (or 35s ago for the first), like the app's back-to-back checkpoints.
   */
  async function nextInput(overrides: Partial<Input> = {}): Promise<Input> {
    const now = BigInt(await time.latest());
    const lastEnd = await registry.lastEndTime(wallet.address);
    const startTime = lastEnd > now - 35n ? lastEnd : now - 35n;
    return {
      seq: (await registry.lastSeq(wallet.address)) + 1n,
      prevRoot: await registry.lastRoot(wallet.address),
      merkleRoot: root(),
      startTime,
      endTime: startTime + 30n,
      avgSpeed: 35,
      maxSpeed: 45,
      minSpeed: 25,
      distanceMeters: 500,
      recordCount: 30,
      ...overrides,
    };
  }

  async function submit(cp: Input, signer: EnclaveKey = key, device = wallet.address) {
    const { r, s } = await sign(registry, device, cp, signer);
    return registry.connect(wallet).submitCheckpoint(device, cp, r, s);
  }

  beforeEach(async function () {
    [owner, registrar, wallet, other] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("SpeedRegistry")).deploy(registrar.address);
    key = makeEnclaveKey();
    await registry.connect(registrar).registerDevice(wallet.address, key.qx, key.qy);
  });

  describe("Device registration (F8)", function () {
    it("only the registrar can register a device key", async function () {
      const attackerKey = makeEnclaveKey();
      await expect(
        registry.connect(other).registerDevice(other.address, attackerKey.qx, attackerKey.qy)
      ).to.be.revertedWithCustomError(registry, "NotRegistrar");
    });

    it("rejects a point that is not on the P-256 curve", async function () {
      await expect(
        registry.connect(registrar).registerDevice(other.address, ethers.toBeHex(1, 32), ethers.toBeHex(1, 32))
      ).to.be.revertedWithCustomError(registry, "InvalidPublicKey");
    });

    it("only the owner can change the registrar", async function () {
      await expect(registry.connect(other).setRegistrar(other.address)).to.be.revertedWithCustomError(
        registry,
        "NotOwner"
      );
      await expect(registry.connect(owner).setRegistrar(other.address))
        .to.emit(registry, "RegistrarChanged")
        .withArgs(registrar.address, other.address);
    });
  });

  describe("Signed checkpoints", function () {
    it("accepts a checkpoint signed by the registered key and records who signed it", async function () {
      const cp = await nextInput();
      await expect(submit(cp))
        .to.emit(registry, "CheckpointSubmitted")
        .withArgs(wallet.address, cp.merkleRoot, 1n, cp.startTime, cp.endTime, cp.avgSpeed, cp.maxSpeed);

      const [stored] = await registry.getDeviceCheckpoints(wallet.address);
      expect(stored.seq).to.equal(1n);
      expect(stored.deviceAddress).to.equal(wallet.address);
      expect(stored.keyHash).to.equal(
        ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [key.qx, key.qy]))
      );
      expect(stored.submittedAt).to.equal(BigInt(await time.latest()));
    });

    it("computes the same digest as the client", async function () {
      const cp = await nextInput();
      expect(await registry.checkpointDigest(wallet.address, cp)).to.equal(
        await clientDigest(registry, wallet.address, cp)
      );
    });

    it("matches the golden digest shared with the app's tests (services/identity)", async function () {
      // The test above proves the contract equals this encoding; the app's test pins the same value.
      const golden: Input = {
        seq: 7n,
        prevRoot: "0x" + "11".repeat(32),
        merkleRoot: "0x" + "22".repeat(32),
        startTime: 1763294400n,
        endTime: 1763294430n,
        avgSpeed: 35,
        maxSpeed: 45,
        minSpeed: 25,
        distanceMeters: 500,
        recordCount: 30,
      };
      const digest = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "address", "address", INPUT_TUPLE],
          [
            ethers.keccak256(ethers.toUtf8Bytes("ChainSpeed.Checkpoint.v2")),
            296n,
            "0x00000000000000000000000000000000000000aa",
            "0x00000000000000000000000000000000000000bb",
            golden,
          ]
        )
      );
      expect(digest).to.equal("0x9bf14b2b2ab464ce68eced28124946410d3750ecf6c692e0270c05a9d6256790");
    });

    it("chains checkpoints: each one references the previous root", async function () {
      const first = await nextInput();
      await submit(first);
      const second = await nextInput();
      expect(second.prevRoot).to.equal(first.merkleRoot);
      expect(second.seq).to.equal(2n);
      await expect(submit(second)).to.emit(registry, "CheckpointSubmitted");
    });

    it("lets anyone relay a signed checkpoint (signature binds the device, not msg.sender)", async function () {
      const cp = await nextInput();
      const { r, s } = await sign(registry, wallet.address, cp, key);
      await expect(registry.connect(other).submitCheckpoint(wallet.address, cp, r, s)).to.emit(
        registry,
        "CheckpointSubmitted"
      );
    });

    it("works on chains where 0x100 burns gas (Hedera), within a normal gas limit", async function () {
      // On Hedera, 0x100 is a system account and calling it consumes all forwarded gas.
      // Simulate that with INVALID (0xfe), which consumes all gas, then submit with a fixed limit.
      await ethers.provider.send("hardhat_setCode", ["0x0000000000000000000000000000000000000100", "0xfe"]);
      try {
        const cp = await nextInput();
        const { r, s } = await sign(registry, wallet.address, cp, key);
        await expect(registry.submitCheckpoint(wallet.address, cp, r, s, { gasLimit: 1_000_000 })).to.emit(
          registry,
          "CheckpointSubmitted"
        );
      } finally {
        await ethers.provider.send("hardhat_setCode", ["0x0000000000000000000000000000000000000100", "0x"]);
      }
    });

    it("reports gas for one signed submission", async function () {
      const cp = await nextInput();
      const receipt = await (await submit(cp)).wait();
      console.log(`      gas used by submitCheckpoint: ${receipt!.gasUsed}`);
    });
  });

  describe("Attacks from the review", function () {
    it("F2: a wallet with no registered key cannot submit", async function () {
      const attackerKey = makeEnclaveKey();
      const cp = await nextInput();
      await expect(submit(cp, attackerKey, other.address))
        .to.be.revertedWithCustomError(registry, "DeviceNotRegistered")
        .withArgs(other.address);
    });

    it("F1: knowing the public key is not enough; another key's signature fails", async function () {
      await expect(submit(await nextInput(), makeEnclaveKey())).to.be.revertedWithCustomError(
        registry,
        "InvalidSignature"
      );
    });

    it("F2: changing any field after signing invalidates the signature", async function () {
      const cp = await nextInput({ avgSpeed: 80 });
      const { r, s } = await sign(registry, wallet.address, cp, key);
      const forged = { ...cp, avgSpeed: 60 }; // claim a lower speed than was signed
      await expect(registry.submitCheckpoint(wallet.address, forged, r, s)).to.be.revertedWithCustomError(
        registry,
        "InvalidSignature"
      );
    });

    it("F11: a signature for one device cannot be replayed as another device", async function () {
      const otherKey = makeEnclaveKey();
      await registry.connect(registrar).registerDevice(other.address, otherKey.qx, otherKey.qy);
      const cp = await nextInput();
      const { r, s } = await sign(registry, wallet.address, cp, key);
      await expect(registry.submitCheckpoint(other.address, cp, r, s)).to.be.revertedWithCustomError(
        registry,
        "InvalidSignature"
      );
    });

    it("F11: a signature cannot be replayed on another deployment of the registry", async function () {
      const twin = await (await ethers.getContractFactory("SpeedRegistry")).deploy(registrar.address);
      await twin.connect(registrar).registerDevice(wallet.address, key.qx, key.qy);
      const cp = await nextInput();
      const { r, s } = await sign(registry, wallet.address, cp, key);
      await expect(twin.submitCheckpoint(wallet.address, cp, r, s)).to.be.revertedWithCustomError(
        twin,
        "InvalidSignature"
      );
    });

    it("rejects a malleable (high-s) copy of a valid signature", async function () {
      const cp = await nextInput();
      const { r, s } = await sign(registry, wallet.address, cp, key);
      const highS = ethers.toBeHex(P256_N - BigInt(s), 32);
      await expect(registry.submitCheckpoint(wallet.address, cp, r, highS)).to.be.revertedWithCustomError(
        registry,
        "InvalidSignature"
      );
    });

    it("F7: rejects a checkpoint submitted more than 10 minutes after its window", async function () {
      const now = BigInt(await time.latest());
      const cp = await nextInput({ startTime: now - 700n, endTime: now - 670n });
      await expect(submit(cp)).to.be.revertedWithCustomError(registry, "StaleCheckpoint");
    });

    it("F7: rejects a window in the future", async function () {
      const now = BigInt(await time.latest());
      const cp = await nextInput({ startTime: now + 100n, endTime: now + 130n });
      await expect(submit(cp)).to.be.revertedWithCustomError(registry, "FutureWindow");
    });

    it("F7: rejects a recent end time paired with a long-ago start", async function () {
      const now = BigInt(await time.latest());
      const cp = await nextInput({ startTime: now - 86_400n, endTime: now - 5n, distanceMeters: 0 });
      await expect(submit(cp)).to.be.revertedWithCustomError(registry, "InvalidWindow");
    });

    it("F7: rejects a window that overlaps the previous checkpoint", async function () {
      await submit(await nextInput());
      const now = BigInt(await time.latest());
      const cp = await nextInput({ startTime: now - 20n, endTime: now - 1n }); // starts before last end
      await expect(submit(cp)).to.be.revertedWithCustomError(registry, "OverlapsPrevious");
    });

    it("rejects replaying the same checkpoint twice", async function () {
      const cp = await nextInput();
      const { r, s } = await sign(registry, wallet.address, cp, key);
      await registry.submitCheckpoint(wallet.address, cp, r, s);
      await expect(registry.submitCheckpoint(wallet.address, cp, r, s))
        .to.be.revertedWithCustomError(registry, "OutOfSequence")
        .withArgs(2n, 1n);
    });

    it("rejects skipping a sequence number (hiding a checkpoint)", async function () {
      const cp = await nextInput({ seq: 2n });
      await expect(submit(cp)).to.be.revertedWithCustomError(registry, "OutOfSequence").withArgs(1n, 2n);
    });

    it("rejects a checkpoint that does not reference the previous root", async function () {
      await submit(await nextInput());
      const cp = await nextInput({ prevRoot: root() });
      await expect(submit(cp)).to.be.revertedWithCustomError(registry, "WrongPrevRoot");
    });

    it("F4/F15: rejects a distance faster than about 100 mph for the window", async function () {
      const cp = await nextInput({ distanceMeters: 65_535 }); // the review's 40-mile checkpoint
      await expect(submit(cp)).to.be.revertedWithCustomError(registry, "ImpossibleDistance");
    });

    it("rejects checkpoints from a revoked key", async function () {
      await registry.connect(registrar).revokeDevice(wallet.address);
      await expect(submit(await nextInput()))
        .to.be.revertedWithCustomError(registry, "DeviceNotRegistered")
        .withArgs(wallet.address);
    });

    it("a replacement key starts a new chain but cannot backfill time the old key covered", async function () {
      const first = await nextInput();
      await submit(first);

      const newKey = makeEnclaveKey();
      await registry.connect(registrar).registerDevice(wallet.address, newKey.qx, newKey.qy);

      // The old key no longer works.
      await expect(submit(await nextInput())).to.be.revertedWithCustomError(registry, "InvalidSignature");

      // The new key cannot re-cover the old window.
      const backfill = await nextInput({ startTime: first.startTime, endTime: first.endTime });
      expect(backfill.seq).to.equal(1n);
      await expect(submit(backfill, newKey)).to.be.revertedWithCustomError(registry, "OverlapsPrevious");

      // But it can continue forward.
      await time.increase(30);
      await expect(submit(await nextInput(), newKey)).to.emit(registry, "CheckpointSubmitted");
    });
  });

  describe("Reads", function () {
    it("returns stats and lookups for submitted checkpoints", async function () {
      const cp = await nextInput();
      await submit(cp);

      expect((await registry.getCheckpointByRoot(cp.merkleRoot)).deviceAddress).to.equal(wallet.address);
      const stats = await registry.getDeviceStats(wallet.address);
      expect(stats.totalDistance).to.equal(500);
      expect(stats.maxRecordedSpeed).to.equal(45);
      expect(stats.checkpointCount).to.equal(1);
      await expect(registry.getCheckpointByRoot(root())).to.be.revertedWithCustomError(
        registry,
        "CheckpointNotFound"
      );
    });
  });
});
