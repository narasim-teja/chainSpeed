import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { SpeedRegistry, XPRewards } from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import { makeEnclaveKey, sign, type EnclaveKey, type Input } from "./helpers";

const DAY = 86_400;

describe("XPRewards v2", function () {
  let registry: SpeedRegistry;
  let xp: XPRewards;
  let registrar: HardhatEthersSigner;
  let wallet: HardhatEthersSigner;
  let key: EnclaveKey;
  let rootCounter = 0;

  /** One signed checkpoint covering the `seconds` just elapsed. Speeds in mph. */
  async function drive({ seconds = 30, meters, avg }: { seconds?: number; meters: number; avg: number }) {
    await time.increase(seconds);
    const now = BigInt(await time.latest());
    const cp: Input = {
      seq: (await registry.lastSeq(wallet.address)) + 1n,
      prevRoot: await registry.lastRoot(wallet.address),
      merkleRoot: ethers.keccak256(ethers.toUtf8Bytes(`xp-root-${rootCounter++}`)),
      startTime: now - BigInt(seconds),
      endTime: now,
      avgSpeed: avg,
      maxSpeed: avg,
      minSpeed: 0,
      distanceMeters: meters,
      recordCount: 30,
    };
    const { r, s } = await sign(registry, wallet.address, cp, key);
    await registry.submitCheckpoint(wallet.address, cp, r, s);
  }

  /** A 10-minute safe checkpoint of 19.8 km (12.3 miles at 74 mph). */
  const longSafeDrive = () => drive({ seconds: 600, meters: 19_800, avg: 74 });

  async function startOfNextDay() {
    const now = await time.latest();
    await time.setNextBlockTimestamp(Math.ceil(now / DAY) * DAY + 60);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    let owner: HardhatEthersSigner;
    [owner, registrar, wallet] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("SpeedRegistry")).connect(owner).deploy(registrar.address);
    xp = await (await ethers.getContractFactory("XPRewards")).deploy(await registry.getAddress());
    key = makeEnclaveKey();
    await registry.connect(registrar).registerDevice(wallet.address, key.qx, key.qy);
    await xp.connect(wallet).toggleDriveToEarn(true);
  });

  it("requires opting in", async function () {
    await xp.connect(wallet).toggleDriveToEarn(false);
    await expect(xp.connect(wallet).processCheckpointsForXP()).to.be.revertedWithCustomError(xp, "DriveToEarnDisabled");
  });

  it("accumulates safe distance across short checkpoints (each under a mile)", async function () {
    // v1 computed distanceMeters / 1609 per checkpoint, so every 30-second checkpoint earned 0.
    // 30 s at 70 mph is about 939 m; three of them pass one mile only when added together.
    for (let i = 0; i < 3; i++) await drive({ meters: 930, avg: 70 });
    await xp.connect(wallet).processCheckpointsForXP();
    const u = await xp.getUserXP(wallet.address);
    expect(u.safeMiles).to.equal(1n); // 2,790 m
    expect(u.totalXP).to.equal(1n);
  });

  it("counts unsafe checkpoints toward lifetime miles but not XP", async function () {
    await drive({ seconds: 600, meters: 21_000, avg: 80 });
    await xp.connect(wallet).processCheckpointsForXP();
    const u = await xp.getUserXP(wallet.address);
    expect(u.lifetimeMiles).to.equal(13n);
    expect(u.totalXP).to.equal(0n);
  });

  it("F18: always advances the cursor, so a second call counts nothing twice", async function () {
    await drive({ seconds: 600, meters: 21_000, avg: 80 }); // earns no XP: v1 left the cursor behind here
    await xp.connect(wallet).processCheckpointsForXP();
    await xp.connect(wallet).processCheckpointsForXP();
    expect((await xp.getUserXP(wallet.address)).lifetimeMiles).to.equal(13n);
    expect((await xp.userXP(wallet.address)).lastCheckpointProcessed).to.equal(1n);
  });

  it("F17: processes at most MAX_BATCH checkpoints per call", async function () {
    const batch = Number(await xp.MAX_BATCH());
    for (let i = 0; i < batch + 1; i++) await drive({ meters: 100, avg: 20 });
    await xp.connect(wallet).processCheckpointsForXP();
    expect((await xp.userXP(wallet.address)).lastCheckpointProcessed).to.equal(BigInt(batch));
    await xp.connect(wallet).processCheckpointsForXP();
    expect((await xp.userXP(wallet.address)).lastCheckpointProcessed).to.equal(BigInt(batch + 1));
  });

  it("caps XP per day", async function () {
    await startOfNextDay();
    for (let i = 0; i < 42; i++) await longSafeDrive(); // about 516 safe miles in one day
    await xp.connect(wallet).processCheckpointsForXP();
    const u = await xp.getUserXP(wallet.address);
    expect(u.safeMiles).to.be.greaterThan(500n);
    expect(u.totalXP).to.equal(await xp.MAX_XP_PER_DAY());
  });

  it("bases streaks on the day of the drive, not the day XP is claimed", async function () {
    await startOfNextDay();
    await drive({ meters: 930, avg: 70 });
    await startOfNextDay();
    await drive({ meters: 930, avg: 70 });
    await time.increase(3 * DAY); // claim days later, all at once
    await xp.connect(wallet).processCheckpointsForXP();
    const u = await xp.getUserXP(wallet.address);
    expect(u.currentStreak).to.equal(2n);
    expect(u.totalXP).to.equal(1n + (await xp.DAILY_STREAK_BONUS())); // 1,860 m = 1 mile, plus the bonus
  });

  it("redemption burns XP and issues no code", async function () {
    for (let day = 0; day < 2; day++) {
      await startOfNextDay();
      for (let i = 0; i < 42; i++) await longSafeDrive();
    }
    await xp.connect(wallet).processCheckpointsForXP();
    const before = (await xp.getUserXP(wallet.address)).totalXP;
    expect(before).to.be.at.least(1000n);

    await expect(xp.connect(wallet).redeemGiftCard("TARGET", 10))
      .to.emit(xp, "RedemptionRequested")
      .withArgs(wallet.address, "TARGET", 10, 1000);
    expect((await xp.getUserXP(wallet.address)).totalXP).to.equal(before - 1000n);
    const [card] = await xp.getUserGiftCards(wallet.address);
    expect(card.code).to.equal("");
    expect(card.redeemed).to.equal(false);
  });

  it("rejects redemptions without enough XP, and unknown cards", async function () {
    await expect(xp.connect(wallet).redeemGiftCard("TARGET", 10))
      .to.be.revertedWithCustomError(xp, "InsufficientXP")
      .withArgs(0, 1000);
    await expect(xp.connect(wallet).redeemGiftCard("AMAZON", 10)).to.be.revertedWithCustomError(xp, "InvalidGiftCard");
  });
});
