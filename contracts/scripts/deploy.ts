import hre from "hardhat";
import "@nomicfoundation/hardhat-ethers";

async function main() {
  console.log("Deploying SpeedRegistry contract to Hedera EVM Testnet...");
  
  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);
  
  // Get account balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${hre.ethers.formatEther(balance)} HBAR`);
  
  // Get the contract factory
  const SpeedRegistry = await hre.ethers.getContractFactory("SpeedRegistry", deployer);
  
  // v2 needs the registrar: the account the device registrar server (server/) signs with.
  // Use a dedicated key; it can register and revoke device keys, nothing else.
  const registrar = process.env.REGISTRAR_ADDRESS;
  if (!registrar || !hre.ethers.isAddress(registrar)) {
    throw new Error("Set REGISTRAR_ADDRESS to the registrar account's address");
  }
  console.log(`Registrar: ${registrar}`);

  console.log("Deploying contract...");
  const speedRegistry = await SpeedRegistry.deploy(registrar);
  
  // Wait for deployment to be mined
  await speedRegistry.waitForDeployment();
  
  const address = await speedRegistry.getAddress();
  console.log(`SpeedRegistry deployed to: ${address}`);
  console.log(`Set EXPO_PUBLIC_SPEED_REGISTRY_ADDRESS (app .env) and REGISTRY_ADDRESS (server/.env) to ${address}`);
  
  // Get deployment transaction details
  const deploymentTx = speedRegistry.deploymentTransaction();
  console.log(`Deployment transaction hash: ${deploymentTx?.hash}`);
  console.log(`Gas used: ${deploymentTx?.gasLimit}`);
  
  return {
    contract: speedRegistry,
    address: address
  };
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then((result) => {
    console.log("\n✅ Deployment successful!");
    console.log(`Contract address: ${result.address}`);
    console.log(`Hedera testnet explorer: https://hashscan.io/testnet/contract/${result.address}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });