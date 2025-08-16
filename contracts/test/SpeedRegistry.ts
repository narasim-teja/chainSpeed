import { expect } from "chai";
import { ethers } from "hardhat";
import { SpeedRegistry } from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";

describe("SpeedRegistry", function () {
  let speedRegistry: SpeedRegistry;
  let owner: any;
  let addr1: any;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    
    const SpeedRegistryFactory = await ethers.getContractFactory("SpeedRegistry");
    speedRegistry = await SpeedRegistryFactory.deploy();
  });

  describe("Checkpoint Submission", function () {
    it("Should submit a checkpoint successfully", async function () {
      const checkpoint = {
        merkleRoot: ethers.keccak256(ethers.toUtf8Bytes("test-merkle-root")),
        startTime: Math.floor(Date.now() / 1000),
        endTime: Math.floor(Date.now() / 1000) + 30,
        avgSpeed: 35,
        maxSpeed: 45,
        minSpeed: 25,
        distanceMeters: 500,
        recordCount: 30,
        deviceAddress: ethers.ZeroAddress, // Will be set by contract
        deviceAttestation: ethers.keccak256(ethers.toUtf8Bytes("device-attestation"))
      };

      await expect(speedRegistry.submitCheckpoint(checkpoint))
        .to.emit(speedRegistry, "CheckpointSubmitted")
        .withArgs(
          owner.address,
          checkpoint.merkleRoot,
          checkpoint.startTime,
          checkpoint.endTime,
          checkpoint.avgSpeed,
          checkpoint.maxSpeed
        );

      expect(await speedRegistry.totalCheckpoints()).to.equal(1);
      expect(await speedRegistry.getDeviceCheckpointCount(owner.address)).to.equal(1);
    });

    it("Should reject invalid checkpoint", async function () {
      const invalidCheckpoint = {
        merkleRoot: ethers.ZeroHash, // Invalid
        startTime: Math.floor(Date.now() / 1000),
        endTime: Math.floor(Date.now() / 1000) + 30,
        avgSpeed: 35,
        maxSpeed: 45,
        minSpeed: 25,
        distanceMeters: 500,
        recordCount: 30,
        deviceAddress: ethers.ZeroAddress,
        deviceAttestation: ethers.keccak256(ethers.toUtf8Bytes("device-attestation"))
      };

      await expect(speedRegistry.submitCheckpoint(invalidCheckpoint))
        .to.be.revertedWith("Invalid merkle root");
    });
  });

  describe("Checkpoint Retrieval", function () {
    beforeEach(async function () {
      // Submit a test checkpoint
      const checkpoint = {
        merkleRoot: ethers.keccak256(ethers.toUtf8Bytes("test-merkle-root")),
        startTime: 1640995200, // Jan 1, 2022
        endTime: 1640995230,   // Jan 1, 2022 + 30s
        avgSpeed: 35,
        maxSpeed: 45,
        minSpeed: 25,
        distanceMeters: 500,
        recordCount: 30,
        deviceAddress: ethers.ZeroAddress,
        deviceAttestation: ethers.keccak256(ethers.toUtf8Bytes("device-attestation"))
      };

      await speedRegistry.submitCheckpoint(checkpoint);
    });

    it("Should retrieve checkpoints by device", async function () {
      const checkpoints = await speedRegistry.getDeviceCheckpoints(owner.address);
      expect(checkpoints.length).to.equal(1);
      expect(checkpoints[0].avgSpeed).to.equal(35);
    });

    it("Should retrieve checkpoint by merkle root", async function () {
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-merkle-root"));
      const checkpoint = await speedRegistry.getCheckpointByRoot(merkleRoot);
      expect(checkpoint.avgSpeed).to.equal(35);
      expect(checkpoint.deviceAddress).to.equal(owner.address);
    });

    it("Should get device statistics", async function () {
      const stats = await speedRegistry.getDeviceStats(owner.address);
      expect(stats.totalDistance).to.equal(500);
      expect(stats.maxRecordedSpeed).to.equal(45);
      expect(stats.checkpointCount).to.equal(1);
    });
  });

  describe("Merkle Proof Verification", function () {
    it("Should verify a simple merkle proof", async function () {
      // Create a simple merkle tree with 2 leaves
      const leaf1 = ethers.keccak256(ethers.toUtf8Bytes("leaf1"));
      const leaf2 = ethers.keccak256(ethers.toUtf8Bytes("leaf2"));
      const merkleRoot = ethers.keccak256(ethers.concat([leaf1, leaf2]));

      // Submit checkpoint with this root
      const checkpoint = {
        merkleRoot: merkleRoot,
        startTime: Math.floor(Date.now() / 1000),
        endTime: Math.floor(Date.now() / 1000) + 30,
        avgSpeed: 35,
        maxSpeed: 45,
        minSpeed: 25,
        distanceMeters: 500,
        recordCount: 2,
        deviceAddress: ethers.ZeroAddress,
        deviceAttestation: ethers.keccak256(ethers.toUtf8Bytes("device-attestation"))
      };

      await speedRegistry.submitCheckpoint(checkpoint);

      // Verify proof for leaf1 (sibling is leaf2, position is right)
      const proof = [leaf2];
      const indices = [1]; // leaf2 is at position 1 (right)

      const isValid = await speedRegistry.verifyMerkleProof(
        merkleRoot,
        proof,
        leaf1,
        indices
      );

      expect(isValid).to.be.true;
    });
  });
});