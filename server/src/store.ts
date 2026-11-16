import { Database } from "bun:sqlite";
import type { AttestEnvironment } from "./appAttest";

export interface DeviceRecord {
  userId: string;
  wallet: string;
  appAttestKeyId: string; // base64
  appAttestPublicKey: string; // hex, kept to verify App Attest assertions later
  receipt: Uint8Array; // kept for Apple fraud-risk checks later
  environment: AttestEnvironment;
  enclavePublicKey: string; // hex, 0x04 ‖ x ‖ y
  keyHash: string;
  txHash: string;
}

/** Registered devices. One row per registration; the latest per wallet is the active key on chain. */
export class DeviceStore {
  private readonly db: Database;

  constructor(path = ":memory:") {
    this.db = new Database(path, { create: true, strict: true });
    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        wallet TEXT NOT NULL,
        app_attest_key_id TEXT NOT NULL UNIQUE,
        app_attest_public_key TEXT NOT NULL,
        receipt BLOB NOT NULL,
        environment TEXT NOT NULL,
        enclave_public_key TEXT NOT NULL UNIQUE,
        key_hash TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS devices_wallet ON devices (wallet)");
  }

  /** An App Attest key or enclave key may only ever be registered once. */
  isKeyUsed(appAttestKeyId: string, enclavePublicKey: string): boolean {
    return (
      this.db
        .query("SELECT 1 FROM devices WHERE app_attest_key_id = ? OR enclave_public_key = ? LIMIT 1")
        .get(appAttestKeyId, enclavePublicKey) !== null
    );
  }

  save(record: DeviceRecord) {
    this.db
      .query(
        `INSERT INTO devices (user_id, wallet, app_attest_key_id, app_attest_public_key, receipt, environment,
                              enclave_public_key, key_hash, tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.userId,
        record.wallet,
        record.appAttestKeyId,
        record.appAttestPublicKey,
        record.receipt,
        record.environment,
        record.enclavePublicKey,
        record.keyHash,
        record.txHash
      );
  }

  latestForWallet(wallet: string) {
    return this.db
      .query("SELECT user_id, wallet, key_hash, tx_hash, environment FROM devices WHERE wallet = ? ORDER BY id DESC LIMIT 1")
      .get(wallet.toLowerCase()) as
      | { user_id: string; wallet: string; key_hash: string; tx_hash: string; environment: string }
      | null;
  }
}
