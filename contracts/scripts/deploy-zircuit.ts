import { ethers } from "hardhat";

async function main() {
  console.log("🔗 Deploying SpeedRegistry contract to Zircuit Testnet...");

  // Get the contract factory
  const SpeedRegistry = await ethers.getContractFactory("SpeedRegistry");

  // Deploy the contract
  console.log("📤 Deploying...");
  const speedRegistry = await SpeedRegistry.deploy();

  await speedRegistry.waitForDeployment();
  const contractAddress = await speedRegistry.getAddress();

  console.log("✅ SpeedRegistry deployed to:", contractAddress);
  console.log("🔗 View on Zircuit Explorer:", `https://explorer.garfield-testnet.zircuit.com/address/${contractAddress}`);

  // Verify the deployment by calling a function
  try {
    const totalCheckpoints = await speedRegistry.totalCheckpoints();
    console.log("📊 Initial total checkpoints:", totalCheckpoints.toString());
    console.log("✅ Contract deployment verified!");
  } catch (error) {
    console.error("❌ Contract verification failed:", error);
  }

  console.log("\n🎉 Deployment Summary:");
  console.log("Network: Zircuit Testnet");
  console.log("Chain ID: 48899");
  console.log("Contract Address:", contractAddress);
  console.log("Explorer:", `https://explorer.garfield-testnet.zircuit.com/address/${contractAddress}`);
  
  console.log("\n📋 Next Steps:");
  console.log("1. Update CONTRACT_CONFIG.address in constants/Blockchain.ts");
  console.log("2. Fund your wallet with testnet ETH from Zircuit faucet");
  console.log("3. Test the application with the new Zircuit network");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });