import { ethers } from "hardhat";

async function main() {
  console.log("Checking Hedera EVM Testnet connection and balance...");

  // Get the first account
  const [account] = await ethers.getSigners();
  console.log("Account address:", account.address);

  // Check balance
  const balance = await account.provider.getBalance(account.address);
  console.log("Balance:", ethers.formatEther(balance), "HBAR");

  // Check network
  const network = await account.provider.getNetwork();
  console.log("Network:", {
    name: network.name,
    chainId: Number(network.chainId),
  });

  // Get latest block
  const blockNumber = await account.provider.getBlockNumber();
  console.log("Latest block:", blockNumber);

  if (Number(network.chainId) === 296) {
    console.log("✅ Successfully connected to Hedera EVM Testnet!");
  } else {
    console.log("❌ Not connected to Hedera EVM Testnet (expected chainId: 296)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });