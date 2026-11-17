# Security review triage

An external static review of commit `ace81c9` (November 2026) reported 24 findings. This document records what I did with each one: whether it holds up against the code, how severe I think it is, what I changed, and what I'm leaving as a documented limit. After fixing, I ran two more independent reviews; their results are below.

## Summary

- **Verified:** I checked every finding against the code. 23 of 24 hold up. F16 is a false positive.
- **Root cause:** most findings were one problem appearing in several places. Nothing proved *who* produced a speed record or *when*. That was fixed as one design ([identity-design.md](identity-design.md)), not six patches.
- **Fixed:** F1, F2, F3, F5, F6, F9, F10, F11, F12, F14, F15, F18, F20, F22 and F23. F19 is superseded by the new design.
- **Partial or documented limits:** F4, F7, F8, F13 and F17. Each one is explained below, along with why it isn't fixed further.
- **Disagreements:** F16 is not an issue. I used a different fix for F6. F21 and F24 aren't security issues. I'd rate F13 higher than the review did.
- **Verified on a device:** registration, signing and on-chain record proofs were run end to end on an iPhone 14 (iOS 26) against Hedera testnet.
- **What fixing surfaced:** two bugs that only showed up on a real device (one of them mine), five issues the review missed, and two further reviews that found real problems in my own fixes. Each round found fewer and smaller issues.

## How I ordered the work

I didn't order the work by severity label. Two things decided it:

1. **Dependencies.** The identity redesign changes the contract interface, because `submitCheckpoint` has to take a signature and a registered key. Patching the contracts first would have meant redoing that work.
2. **Exposure.** Nothing is live. The contracts are on testnets, there are no real users, and the gift cards were mock strings. That made it reasonable to fix the root cause first.

**If this were a live App Store app, I'd flip the order.** Same day: pause XP redemption and correct the public claims. Next: ship the exploitable contract fixes (root overwrite, unbounded XP). Then: the identity redesign. With live users, you stop the bleeding before you fix the architecture.

## Findings

| ID | Finding | Holds up | Severity (review → mine) | Status |
| --- | --- | --- | --- | --- |
| F1 | "Secure Enclave signing" is SHA-256 over constants | Yes | Critical → Critical | **Fixed.** Real non-exportable P-256 enclave key (`modules/secure-enclave`) |
| F2 | Contract accepts unsigned, caller-chosen checkpoints | Yes | Critical → Critical | **Fixed.** P-256 signature verified on chain against the registered key |
| F3 | Client SHA-256 trees vs contract keccak256 verifier | Yes | High → High | **Fixed.** OpenZeppelin's standard tree on both sides; `verifyRecord` checks proofs the app produces |
| F4 | XP from unverified client distance | Yes | High → High | **Partial.** XP comes only from signed checkpoints; distance must match the window's average speed; daily cap. The numbers still come from the device (see limits). |
| F5 | Anyone can overwrite `checkpointByRoot` | Yes | High → High | **Fixed.** Lookups are per (device, root), and leaves are bound to the device |
| F6 | Biometric gate is a session boolean | Yes | High → Medium | **Fixed, with a different fix.** The OS enforces Face ID on the key, once per drive, and a session lasts at most 4 hours |
| F7 | Device clock; unbounded backdating | Yes | High → High | **Partial.** A checkpoint must land within 10 minutes of its window, in sequence, with no overlap. Times still come from the device clock. |
| F8 | No App Attest, registration or key binding | Yes | High → High | **Partial.** App Attest is verified at registration and the key is bound to the Privy wallet. App Attest vouches for the app binary, not the JavaScript it runs (see limits). |
| F9 | No domain separation; odd leaf duplicated | Yes | Medium → Medium | **Fixed.** Double-hashed leaves, no duplication. `recordCount` is still a signed claim, not derived from the tree. |
| F10 | Silent software fallback; any signature counts | Yes | Medium → Medium | **Fixed.** No signing fallback. The proof screen says "verified" only when every checkpoint, record proof and signing key checks out, and shows coverage and gaps separately. |
| F11 | Checkpoint "signature" is software and discarded | Yes | Medium → Medium | **Fixed.** The enclave signature is submitted and verified |
| F12 | `updateCityStats` has no access control | Yes | Medium → Low | **Fixed.** Removed, along with the per-record geocoding that fed it |
| F13 | Precise GPS in plaintext; aggregation is a stub | Yes | Medium → **High** | **Partial.** Encrypted at rest, no geocoding, salted leaves, no coordinates in logs. Leaves still hold precise coordinates, and per-checkpoint stats are public on chain. |
| F14 | App Transport Security disabled | Yes | Medium → Medium | **Fixed.** Plain HTTP allowed only on the local network |
| F15 | Client clamps invalid values | Yes | Medium → Medium | **Fixed.** Invalid values throw; an invalid GPS speed (iOS reports −1) is treated as unknown rather than 0 mph; the contract checks min ≤ avg ≤ max and distance against average speed |
| F16 | No `NSFaceIDUsageDescription` | **No** | Medium → none | False positive (see below). An explicit string is now set anyway. |
| F17 | Unbounded arrays and loops | Yes | Low → Low | **Partial.** XP processing is batched. The registry's history read functions still grow with history. |
| F18 | XP cursor only advances when XP > 0 | Yes | Low → Low | **Fixed** |
| F19 | Signature chain head in memory only | Yes | Low → Low | **Superseded.** The evidence chain is now on chain (`seq` + `prevRoot`). The per-record hash chain is labeled `SW:` and isn't evidence. |
| F20 | Records deleted after 24 hours | Yes | Low → Low | **Fixed.** Proof records are kept 30 days, encrypted, and orphans are deleted; proofs read from them |
| F21 | Privy app ID and client ID committed | Yes | Low → Info | Won't fix: these are public identifiers |
| F22 | No XPRewards tests; Merkle test used the wrong hash | Yes | Info → Medium | **Fixed.** XPRewards tests added; the contract's Merkle tests use the app's own tree code |
| F23 | Docs claim things that don't exist | Yes | Info → High | **Fixed.** The second review found legal claims still in the app UI and iOS permission prompts; those are now removed too. |
| F24 | Zircuit deployment unreachable | Yes | Medium → Info | Docs no longer claim multi-chain. The Zircuit deploy scripts are v1 and not maintained. |

## Where I disagree

**F16: false positive.** `app.json` includes the `expo-secure-store` config plugin, which adds `NSFaceIDUsageDescription` at prebuild. The review couldn't see this because `ios/` is gitignored; `bunx expo config --type introspect` shows the key. Face ID prompts correctly on a device.

**F6: right problem, wrong fix.** The review suggests a Face ID prompt on every signature, or every 60–120 seconds. This app runs while someone is driving, so that is unusable and unsafe. The property that matters is a non-exportable key and a verified signature, not repeated biometrics. So it's one Face ID per drive, enforced by the OS on the key, with the session capped at 4 hours.

**F21: not a secret.** Privy's app ID and client ID ship inside every app bundle by design. The real control is the allowed app identifiers in the Privy dashboard.

**F24: not a security issue.** It was a false README claim, and that claim is gone.

**F13: higher than rated.** Per-second traces at 6 decimal places reveal home, work and routine within days. For a product that claims privacy, I'd rate this High.

## Missed by the first review

1. **XP could never be earned.** XP divided each checkpoint's distance by 1,609 and rounded down, and a 30-second checkpoint is under a mile, so every checkpoint earned 0. Fixed: meters accumulate.
2. **Streaks rewarded claiming, not driving.** The streak used the time XP was processed. Fixed: it uses the checkpoint's time.
3. **The app invented gift-card codes.** When a chain read failed, `XPService` generated a random "code" locally. Fixed: no codes are shown; redemption burns XP and records a request.
4. **`block.difficulty`** is deprecated since the merge. Removed along with the fake codes.
5. **The Android package ID is the starter template's** (`dev.privy.example`). Still open; there is no Android build.

## Found while fixing (on a real device)

**1. OpenZeppelin's `P256.verify` runs out of gas on Hedera.** It first tries the secp256r1 precompile at `0x100`. On Hedera, that address is a system account, and calling it consumes all the gas the call is given, so the fallback never runs. Every checkpoint failed with `INSUFFICIENT_GAS`. Local tests missed it because recent Hardhat hardforks *do* have a precompile there.
- **Fix:** call `P256.verifySolidity` directly, and pin the local chain to Hedera's EVM (`cancun`).
- **Regression test:** plants a gas-burning account at `0x100`; it fails on the old code and passes on the fix.
- **Cost:** about 540k gas per checkpoint after the F5 change, roughly 0.8 testnet HBAR.

**2. Retried checkpoints were relabeled with new times (my bug).** A queued checkpoint's window was moved forward to after the chain head, and the freshness check ran on the moved time. Three checkpoints recorded around 23:24 were anchored as 1-second windows at 23:32. Every protocol rule was satisfied, which is what made it dangerous.
- **Fix:** freshness is judged on the window as recorded; it may shift by at most one second of rounding; an older checkpoint is set aside rather than re-timed.
- **Record of the bug:** the three relabeled checkpoints stay on testnet registry `0xcDD3…6b39`.

## Second review

After the fixes, I ran four independent reviewers: contracts, identity and attestation, the app client, and claims against the code. They were given the code and the original report, and told not to trust my docs or commit messages. They confirmed most fixes and found real problems, several in my own changes. I checked each finding against the code before acting on it.

### Fixed

- **Root squatting.** Another registered device could anchor my Merkle root and then pass my disclosed records off as its own (a false alibi). Leaves now include the device address. A regression test reproduces the attack.
- **Speed not tied to distance.** A checkpoint claiming 0 mph could carry 27 km of "safe" distance. I bounded distance by the checkpoint's max speed. My own XP tests had used physically impossible data and missed this. The third review showed this fix was both too weak and too strict; see below.
- **Records dropped during submission.** The batch was cleared only after awaiting the transaction, so records arriving meanwhile were lost: 6–7 second gaps between windows. It's now taken before any await, and checkpoints are created one at a time. On the device, gaps went down to about 1 second.
- **One failure could make a window permanently unanchorable.** A newer checkpoint could land first and move the chain head. Checkpoints are now submitted strictly oldest first. A transient failure holds the queue; only permanent failures are set aside, and only after checking the chain in case the transaction landed.
- **Wallet transactions collided.** On the device, the last checkpoint and the XP call raced and got the same nonce. All wallet writes are now serialized.
- **Duplicate records.** A rejected GPS update re-committed the previous record. Only new records are committed now.
- **Retention was unusable.** Proofs read a live buffer of about 48 minutes, not the 30-day bundles. Proofs now come from the bundles. Values that can't be decrypted (after a restore to another phone) are set aside instead of blocking all later writes.
- **The proof screen overstated.** "Verified" now requires every sampled record proof to pass on chain and the key to be active. The exported proof includes the record proofs, so a third party can check them with `verifyRecord`.
- **Legal claims in the app.** The "Can be used as evidence in legal proceedings" wording and the "legal protection" iOS permission text are removed (F23).
- **Smaller fixes:**
  - The drive session always ends on Stop and lasts at most 4 hours.
  - Re-registering no longer deletes the working key before the new one is registered.
  - The XP contract is asked to process after every drive when drive-to-earn is on, not only when the app's own estimate is positive.
  - Coordinates are no longer logged.

### Documented limits, not fixed now

- **App Attest vouches for the native app, not the JavaScript it runs.** The native module attests, and signs, whatever the JavaScript gives it. A user running a development build, or a jailbroken phone, can feed fabricated data to a genuinely attested key. Apple's attestation covers the App Attest key; the enclave key is only bound to it through the attested `clientDataHash`.
  - The real fix: release builds in the production App Attest environment; checkpoints built and hashed in native code from Core Location; App Attest assertions per drive or per checkpoint.
  - Why not now: that is the next major piece of work, not a patch.
- **The registrar is trusted.**
  - Its key can register, replace or revoke any wallet's device key.
  - Attestations stay in the registrar's database, so a third party cannot audit a registration.
  - A stolen Privy identity token is enough to re-register a wallet.
  - There's no rate limiting.
  - Fixes would include publishing a hash of each attestation on chain, requiring the old key or a wallet signature to rotate, a timelock on key replacement, and keeping the registrar key in a KMS.
- **Omission is possible.** Sequencing prevents reordering and deletion of anchored checkpoints, but a device can choose not to anchor a window. A gap on chain looks the same as not driving.
- **Public metadata.** Every checkpoint's window, speed stats and distance are public and permanently linked to the wallet.
- **The contract owner is as trusted as the registrar.** The owner can replace the registrar at any time, with no timelock, and ownership cannot be transferred.
- **No background recording.** Background location isn't enabled, so recording only happens while the app is open.
- **Smaller limits:**
  - The registry's history read functions copy the whole history. They pass about 15M gas at roughly 1,000 checkpoints (about 8 hours of driving), and the proof screen uses them.
  - Revoking a key doesn't flag its past checkpoints: they still verify with `verifyRecord`, and still earn XP.
  - XP is processed in batches of 100 checkpoints (about 50 minutes) per drive, so very long drives leave a backlog.
  - A streak bonus needs no minimum distance.
  - Leaves still commit to precise coordinates; coarse commitments would trade evidence precision for privacy.
  - The contract still has a `requestProofForLegal` function. It only emits an event, but the name is a leftover of the old claims.
- **Not built:** Android, gift-card fulfillment, city-level aggregation, user-chosen retention or legal hold.

## On-device test evidence

Final run, after the third review's fixes: an iPhone 14 (iOS 26) against Hedera testnet, on SpeedRegistry [`0xA349…1A89`](https://hashscan.io/testnet/contract/0xA34977f6A891AF559f1038E1EA10122687281A89) and XPRewards [`0x515e…2F4E`](https://hashscan.io/testnet/contract/0x515e82ca4bb8F5F171F513546cEaCeFe6E6b2F4E), wallet `0x023c4C23CEc833C98C4D65b0D3448070b76fFFbA`.

- **Checkpoints:** 7 signed checkpoints over two short drives, chained seq 1–7. Each was anchored 1–6 s after its window ended, with about 1 s between windows within a drive.
- **Standing still:** windows recorded while standing still (average 0 mph) were accepted.
- **Short windows:** windows of 1–5 s were accepted.
- **Problems:** no unanchored checkpoints and no nonce collisions.
- **First and last checkpoint transactions:** [`0x8c25…bbe2`](https://hashscan.io/testnet/transaction/0x8c25ef892622557b98adc26f2458cf6ae61bcc13333edcdd9d57da0f5faabbe2), [`0xc6de…d6be`](https://hashscan.io/testnet/transaction/0xc6de520189f991665039093deff88459b3ff57869a488ced9e0526e17e50d6be).
- **XP:** processed after each drive ([`0xb3fc…a934`](https://hashscan.io/testnet/transaction/0xb3fc15417180f26ec542afac0ebfddb26353bd7c813d7c0e8a50493c7f84a934)). The cursor is at 7, and 90 m is counted, matching the 7 checkpoints' distances.
- **Proof screen:** "verified", with record proofs checked on chain and coverage reported.
- **Earlier runs:** registration with a real App Attest attestation (the fixture in `server/test/fixtures/`), 8/8 and 3/3 record proofs verified on earlier registry versions, and the two bugs described in "Found while fixing".

## Third review

A third set of independent reviewers checked the second-review fixes. Most held: root squatting is closed, records are no longer dropped, wallet transactions are serialized, and retention and proofs work. They found two fixes of mine that didn't hold, plus smaller issues. I checked each against the code before acting.

### Fixed

- **My new queue could erase a checkpoint.** A checkpoint queued while another drain was running was overwritten by that drain's older snapshot: never sent, never marked unanchored. The reviewer reproduced it. Enqueueing now happens inside the same lock as draining, and their reproduction is now a regression test.
- **The distance rule was both too weak and too strict.**
  - Too weak: it used the max speed, but "safe" XP uses the average, so avg 0 / max 100 mph still earned safe miles.
  - Too strict: it rejected real windows. A 1-second window at Stop, iOS reporting an invalid speed as −1 (recorded as 0), and GPS jitter at a red light were all permanently set aside.
  - Fix: distance must match (average speed + 5 mph) × window + 50 m, and −1 is treated as unknown.
  - Tests cover both the attacks and the real-world cases.
- **"Proof Verified" ignored coverage.** One 30-second checkpoint in a 60-minute range showed as verified, and checkpoints weren't checked against the active key. The proof now shows anchored minutes against requested minutes, plus the number of gaps, and requires every checkpoint to be signed by the active key.
- **The app could think it was registered when the chain disagreed.** A registration whose transaction landed after the server gave up left the phone signing with a key the chain didn't know. The app now compares its key with the on-chain key and asks to register again if they differ. A new key is deleted only when the server definitively rejects it.
- **Smaller fixes:**
  - Wallet requests time out instead of being able to stall everything.
  - Queued checkpoints remember which wallet they were built for.
  - A failed "already anchored?" check counts as transient.
  - Queue overflow is recorded as unanchored rather than dropped.
  - Each GPS update commits the record it produced (no shared-variable race).
  - The 4-hour session cap uses a monotonic clock.
  - Retention also runs at startup.
  - The debug "Clear Pending" button is dev-only.
  - Errors that could include coordinates are no longer logged.
  - The motion-sensor permission text no longer claims to validate GPS.
  - Doc statements the reviewers found stale are corrected.

### Documented, not fixed

These are listed in the limits above: the owner's power over the registrar, revoked keys' history still verifying and earning XP, the XP batch backlog on very long drives, no background recording, and the `requestProofForLegal` name.
