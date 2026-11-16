import { toBase64Url } from "./bytes";

export interface IssuedChallenge {
  challenge: string; // base64url, 32 random bytes
  expiresAt: string;
}

/**
 * Single-use, short-lived registration challenges. Held in memory: a restart
 * only invalidates in-flight registrations, which the app retries. Move to a
 * shared store before running more than one server instance.
 */
export class ChallengeStore {
  private readonly pending = new Map<string, number>();

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  issue(): IssuedChallenge {
    this.sweep();
    const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = this.now() + this.ttlMs;
    this.pending.set(challenge, expiresAt);
    return { challenge, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** True once per issued, unexpired challenge. Consuming is what makes it single-use. */
  consume(challenge: string): boolean {
    const expiresAt = this.pending.get(challenge);
    this.pending.delete(challenge);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  private sweep() {
    const now = this.now();
    for (const [challenge, expiresAt] of this.pending) {
      if (expiresAt <= now) this.pending.delete(challenge);
    }
  }
}
