import hre from "hardhat";
import "@nomicfoundation/hardhat-ethers";

async function main() {
  console.log("Deploying SpeedRegistry contract to Flow testnet...");
  
  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);
  
  // Get account balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${hre.ethers.formatEther(balance)} FLOW`);
  
  // Get the contract factory
  const SpeedRegistry = await hre.ethers.getContractFactory("SpeedRegistry", deployer);
  
  // Deploy the contract
  console.log("Deploying contract...");
  const speedRegistry = await SpeedRegistry.deploy();
  
  // Wait for deployment to be mined
  await speedRegistry.waitForDeployment();
  
  const address = await speedRegistry.getAddress();
  console.log(`SpeedRegistry deployed to: ${address}`);
  
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
    console.log(`Flow testnet explorer: https://evm-testnet.flowscan.io/address/${result.address}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });