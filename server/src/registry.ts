import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface RegistryClient {
  /** Registers the enclave key on chain and resolves once the transaction succeeds. */
  registerDevice(device: Address, qx: Hex, qy: Hex): Promise<Hex>;
}

const abi = parseAbi(["function registerDevice(address device, bytes32 qx, bytes32 qy)"]);

/** Calls SpeedRegistry.registerDevice from the registrar account. */
export class ViemRegistryClient implements RegistryClient {
  private readonly wallet;
  private readonly reader;

  constructor(
    private readonly registryAddress: Address,
    registrarPrivateKey: Hex,
    chain: Chain,
    rpcUrl: string
  ) {
    const transport = http(rpcUrl);
    this.wallet = createWalletClient({ account: privateKeyToAccount(registrarPrivateKey), chain, transport });
    this.reader = createPublicClient({ chain, transport });
  }

  async registerDevice(device: Address, qx: Hex, qy: Hex): Promise<Hex> {
    const hash = await this.wallet.writeContract({
      address: this.registryAddress,
      abi,
      functionName: "registerDevice",
      args: [device, qx, qy],
    });
    const receipt = await this.reader.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`registerDevice reverted: ${hash}`);
    return hash;
  }
}
