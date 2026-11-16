# Security review triage

An external static review of commit `ace81c9` (November 2026) reported 24 findings. This document records what I did with each one: whether it holds up against the code, how severe I think it is, and what I'm doing about it.

## Summary

- **Verified:** I checked every finding against the code. 23 of 24 hold up. One (F16) is a false positive.
- **Root cause:** most findings are one problem showing up in several places. Nothing proves *who* produced a speed record or *when*. There is no real enclave key, no attestation, no key registration, and no signed checkpoint. Fixing that is one design, not six patches.
- **Disagreements:** F16 is not an issue. I disagree with the proposed fix for F6. F21 and F24 are not security issues. I'd rate F13 higher than the review did.
- **Already done:** F23 (the docs overclaimed). The README and docs were corrected first, because the gap between the claims and the code was the most serious problem.
- **Missed by the review:** four smaller things, listed below.
- **Tier 1 is done** and verified on a physical iPhone 14 against Hedera testnet. Fixing it surfaced two more bugs, one of them mine. Both are recorded below in "Found while fixing".

## How I ordered the work

I didn't order the work by the review's severity labels. Two things decided the order:

1. **Dependencies.** The identity redesign changes the contract interface, because `submitCheckpoint` has to take a signature and a registered key. Patching the contracts first would mean redoing that work.
2. **Exposure.** Nothing is live. The contracts are on testnets, there are no real users, and the gift cards are mock strings. That makes it reasonable to fix the root cause first.

**If this were a live App Store app, I'd flip the order.** Same day: pause XP redemption and correct the public claims. Next: ship the exploitable contract fixes (root overwrite, unbounded XP). Then: the identity redesign. With live users, you stop the bleeding before you fix the architecture.

## Findings

| ID | Finding | Verified | Review severity → mine | Decision |
| --- | --- | --- | --- | --- |
| F1 | "Secure Enclave signing" is SHA-256 over constants; no key exists | Yes | Critical → Critical | **Fixed** (Tier 1) |
| F2 | Contract accepts unsigned, caller-chosen checkpoints | Yes | Critical → Critical | **Fixed** (Tier 1) |
| F6 | Biometric gate is a session boolean | Yes | High → Medium | **Fixed** (Tier 1), with a different fix (see below) |
| F7 | Device clock; checkpoints can be backdated | Yes | High → High | **Fixed** (Tier 1): bounded by `block.timestamp`, sequence and chaining |
| F8 | No App Attest, key registration, or key-to-user binding | Yes | High → High | **Fixed** (Tier 1) |
| F11 | Checkpoint "signature" is software and never submitted | Yes | Medium → Medium | **Fixed** (Tier 1) |
| F3 | Client trees use SHA-256, contract verifies with keccak256 | Yes | High → High | Tier 2 |
| F4 | XP computed from unverified client distance | Yes | High → High | Tier 2 bounds now; full fix needs Tier 1 |
| F5 | Any caller can overwrite `checkpointByRoot` | Yes | High → High | Tier 2 |
| F9 | No domain separation; odd leaf duplicated | Yes | Medium → Medium | Tier 2 |
| F12 | `updateCityStats` has no access control | Yes | Medium → Low | Tier 2 (remove; nothing calls it) |
| F15 | Client clamps invalid values instead of rejecting | Yes | Medium → Medium | Tier 2 |
| F17 | Unbounded arrays and loops | Yes | Low → Low | Tier 2 (incremental aggregates in the rewrite) |
| F18 | XP cursor only advances when XP > 0 | Yes | Low → Low | Tier 2 |
| F22 | No XPRewards tests; Merkle test uses the wrong hash | Yes | Info → Medium | Tier 2 (this is why F3 slipped through) |
| F10 | Silent software fallback; any signature counts as valid | Yes | Medium → Medium | Tier 3 |
| F13 | Precise GPS in plaintext; aggregation is a stub | Yes | Medium → **High** | Tier 3 |
| F14 | App Transport Security disabled | Yes | Medium → Medium | Tier 3 |
| F19 | Signature chain head is in memory only | Yes | Low → Low | Tier 3 (superseded by on-chain checkpoint chaining) |
| F20 | Records deleted after 24 hours | Yes | Low → Low | Tier 3 (resolve together with F13) |
| F23 | Docs claim things that don't exist | Yes | Info → High | **Done** |
| F24 | Zircuit deployment unreachable from the app | Yes | Medium → Info | Done (docs no longer claim multi-chain) |
| F21 | Privy app ID and client ID committed | Yes | Low → Info | Won't fix (see below) |
| F16 | No `NSFaceIDUsageDescription` | **No** | Medium → none | False positive (see below); Face ID prompts correctly on device |

## Where I disagree

**F16: false positive.** `app.json` includes the `expo-secure-store` config plugin, which adds `NSFaceIDUsageDescription` at prebuild. The review couldn't see this because `ios/` is gitignored. Running `bunx expo config --type introspect` shows the evaluated Info.plist with the key set to `Allow $(PRODUCT_NAME) to access your Face ID biometric data.` The finding is still a useful reminder: I'll set an explicit string instead of the default, and Tier 3 makes the fallback loud, so a missing key could never fail silently.

**F6: right problem, wrong fix.** The review suggests a Face ID prompt on every signature, or every 60–120 seconds. This app runs while someone is driving, so prompting for Face ID every minute is unusable and unsafe. Biometrics also isn't the property that matters. What matters is that the key can't leave the device, that the device and app are genuine (App Attest), and that a server verifies the signature. My fix: one biometric check to start a drive session, a non-exportable enclave key, and checkpoints signed and verified off-device. The client-side boolean stops being a gate at all.

**F21: not a secret.** Privy's app ID and client ID are public client identifiers. They ship inside every app bundle by design. The real control is the allowed app identifiers and origins configured in the Privy dashboard. I'll check that config (see the Android package ID below), but I won't remove the IDs.

**F24: not a security issue.** It was a false claim in the README, and that claim is gone. Wiring up Zircuit isn't on the roadmap.

**F13: higher than rated.** Per-second traces at 6 decimal places (about 11 cm) reveal home, work and routine within days, and they're stored in plaintext. For a product that claims privacy, I'd rate this High. It also conflicts with F20: keeping records longer helps evidence but hurts privacy. I'll resolve both together with encrypted storage, coarse commitments in the tree instead of raw coordinates, and user-chosen retention.

## Missed by the review

1. **The Android package ID is still the starter template's.** It's `dev.privy.example` (`app.json`), while iOS uses `com.narasimha.chainspeed`. This matters for identity: App Attest and Play Integrity key off the app identifier, and so does Privy's allowed-app check. The app is claiming another app's identity. Fix: give it its own package ID and update the Privy allowlist.
2. **Streaks reward claiming, not driving.** `processCheckpointsForXP` sets `lastDriveDate = block.timestamp`, the time XP is *processed*, not when the drive happened. Claiming on consecutive days earns streak bonuses whenever you drove. Low severity, fixed in the Tier 2 rewrite.
3. **`block.difficulty` is deprecated** since the merge (it now returns `prevrandao`). It doesn't matter for mock codes, but anything that needs unpredictability on chain needs a different source. Info.
4. **Even the fixed design has a limit.** The enclave signs whatever the JavaScript hands it, so a hooked app or spoofed GPS can still produce signed false data. App Attest narrows this. It doesn't remove it. Any "evidence" claim has to say so, and the README will.

## Found while fixing

Building Tier 1 and running it on a real phone surfaced two bugs that unit tests with fakes did not.

**1. OpenZeppelin's `P256.verify` runs out of gas on Hedera.** `verify` first tries the secp256r1 precompile at `0x100` and falls back to Solidity if it is absent. On Hedera, `0x100` is a system account (`0.0.256`), and calling it consumes all forwarded gas, so the fallback never has enough. Every checkpoint failed simulation with `INSUFFICIENT_GAS`. Local tests missed it because recent Hardhat hardforks *do* have a precompile at `0x100`. The fix: call `P256.verifySolidity` directly, and pin the local chain to Hedera's EVM (`cancun`). A regression test that plants a gas-burning account at `0x100` fails on the old code and passes on the fix. Side effect: the real cost is about 630k gas per checkpoint (about 0.9 testnet HBAR), not the 391k measured with the precompile.

**2. Retried checkpoints were relabeled with new times (my bug).** After a failed submission, checkpoints queue for retry. My "never overlap the previous window" rule moved a queued checkpoint's window forward to after the chain head, and the freshness check ran on the moved time. Three checkpoints recorded at about 23:24 were signed and anchored as 1-second windows at 23:32:30–33. Every protocol rule was satisfied, which is what makes this dangerous: the enclave signs whatever times the app hands it. The fix: freshness is judged on the recorded window, the window may shift by at most one second of rounding, and a checkpoint older than the chain head is marked unanchored instead of re-timed. Two regression tests reproduce the device sequence. The three relabeled checkpoints (seq 4–6 for wallet `0x023c…FFbA` on registry `0xcDD3…6b39`) stay on testnet as the record of this bug.

## Plan

**Tier 1: identity and sign-up (F1, F2, F6, F7, F8, F11). Done.** See [identity-design.md](identity-design.md). Built and verified on device:

- A non-exportable P-256 Secure Enclave key, behind a small native module.
- App Attest verified by a small server at sign-up, binding the key to the Privy user.
- A server nonce per drive session, plus a monotonic sequence number in every signed payload.
- Checkpoints signed by the enclave key, each referencing the previous checkpoint's root. They're verified before they're accepted, with freshness bounds against `block.timestamp`.

**Tier 2: contracts (F3, F4, F5, F9, F12, F15, F17, F18, F22).**

- One hash scheme (keccak256, with domain-separated leaves and nodes), tested against proofs generated by the client code.
- Duplicate-root rejection.
- Distance bounded by elapsed time; invalid values rejected instead of clamped.
- The XP cursor always advances, and streaks use drive time.
- `updateCityStats` removed.
- XPRewards tests, with a negative test for each finding.

**Tier 3: privacy and fail-closed (F10, F13, F14, F19, F20).**

- Encrypted local storage.
- Coarse commitments instead of raw coordinates.
- User-chosen retention.
- ATS restored.
- Unverified records excluded from rewards and proofs, and shown as unverified in the UI.

Each finding gets its own commit referencing its ID, and its own test, including a check that the attack described in the review no longer works.
