import { PrivyClient, isEmbeddedWalletLinkedAccount } from "@privy-io/node";

export interface VerifiedIdentity {
  userId: string;
  /** Lowercased Ethereum addresses of the user's Privy embedded wallets. */
  walletAddresses: string[];
}

export interface IdentityVerifier {
  /** Throws if the token is invalid or expired. */
  verify(identityToken: string): Promise<VerifiedIdentity>;
}

/**
 * Verifies a Privy identity token. Verifying it also returns the user's linked
 * accounts, so we learn which wallets belong to the user in the same step.
 * Requires "Return user data in an identity token" in the Privy dashboard.
 */
export class PrivyIdentityVerifier implements IdentityVerifier {
  private readonly privy: PrivyClient;

  constructor(appId: string, appSecret: string) {
    this.privy = new PrivyClient({ appId, appSecret });
  }

  async verify(identityToken: string): Promise<VerifiedIdentity> {
    const user = await this.privy.users().get({ id_token: identityToken });
    const walletAddresses = user.linked_accounts
      .filter(isEmbeddedWalletLinkedAccount)
      .filter((account) => account.chain_type === "ethereum")
      .map((account) => account.address.toLowerCase());
    return { userId: user.id, walletAddresses };
  }
}
