import { ethers } from "hardhat";

async function main() {
  console.log("🎯 Deploying XPRewards contract to Zircuit Testnet...");

  // Get the deployed SpeedRegistry address
  // You'll need to update this with your actual SpeedRegistry address
  const SPEED_REGISTRY_ADDRESS = process.env.SPEED_REGISTRY_ADDRESS || "0x..."; // Replace with actual address
  
  if (SPEED_REGISTRY_ADDRESS === "0x...") {
    console.error("❌ Please set SPEED_REGISTRY_ADDRESS environment variable");
    console.log("Example: SPEED_REGISTRY_ADDRESS=0x1234... npm run deploy:xp-rewards-zircuit");
    process.exit(1);
  }

  // Get the contract factory
  const XPRewards = await ethers.getContractFactory("XPRewards");

  // Deploy the contract
  console.log("📤 Deploying XPRewards with SpeedRegistry at:", SPEED_REGISTRY_ADDRESS);
  const xpRewards = await XPRewards.deploy(SPEED_REGISTRY_ADDRESS);

  await xpRewards.waitForDeployment();
  const xpAddress = await xpRewards.getAddress();

  console.log("✅ XPRewards deployed to:", xpAddress);
  
  // Verify the deployment
  console.log("🔍 Verifying deployment...");
  
  try {
    // Test basic contract functions
    const speedRegistryAddress = await xpRewards.speedRegistry();
    console.log("📋 SpeedRegistry reference:", speedRegistryAddress);
    
    const xpPerMile = await xpRewards.XP_PER_SAFE_MILE();
    console.log("🎯 XP per safe mile:", xpPerMile.toString());
    
    const streakBonus = await xpRewards.DAILY_STREAK_BONUS();
    console.log("🔥 Daily streak bonus:", streakBonus.toString());
    
    // Get gift card options
    const giftCardOptions = await xpRewards.getGiftCardOptions();
    console.log("🎁 Gift card options:", giftCardOptions[0].length, "available");
    
    console.log("✅ Contract verification successful!");
    
  } catch (error) {
    console.error("❌ Contract verification failed:", error);
  }

  console.log("\n📋 Deployment Summary:");
  console.log("Network: Zircuit Testnet");
  console.log("Chain ID: 48899");
  console.log("XPRewards Address:", xpAddress);
  console.log("SpeedRegistry Address:", SPEED_REGISTRY_ADDRESS);
  console.log("Deployer: Not available in this context");
  console.log("Deployed At:", new Date().toISOString());
  console.log("Explorer:", `https://explorer.garfield-testnet.zircuit.com/address/${xpAddress}`);

  console.log("\n🔧 Next Steps:");
  console.log("1. Update your app's blockchain service with the new XPRewards address");
  console.log("2. Test the drive-to-earn functionality");
  console.log("3. Verify the contract on the block explorer if needed");

  console.log("\n💾 Save this deployment info:");
  console.log(`XP_REWARDS_ADDRESS=${xpAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });