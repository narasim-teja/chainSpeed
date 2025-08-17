import { ethers } from "hardhat";

async function main() {
  console.log("Deploying SpeedRegistry to Hedera EVM Testnet...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Check balance
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "HBAR");

  // Deploy the SpeedRegistry contract
  const SpeedRegistry = await ethers.getContractFactory("SpeedRegistry");
  const speedRegistry = await SpeedRegistry.deploy();

  await speedRegistry.waitForDeployment();
  const contractAddress = await speedRegistry.getAddress();

  console.log("✅ SpeedRegistry deployed to:", contractAddress);
  console.log("🔗 View on Hedera Explorer:", `https://hashscan.io/testnet/contract/${contractAddress}`);
  
  // Verify the contract is working
  try {
    const deviceCheckpoints = await speedRegistry.getDeviceCheckpoints(deployer.address);
    console.log("✅ Contract verification successful - device checkpoints:", deviceCheckpoints.length);
  } catch (error) {
    console.error("❌ Contract verification failed:", error);
  }

  console.log("\n📝 Next steps:");
  console.log("1. Update CONTRACT_CONFIG.address in constants/Blockchain.ts to:", contractAddress);
  console.log("2. Fund your wallet with testnet HBAR from: https://portal.hedera.com/");
  console.log("3. Test the application with the new Hedera network");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });