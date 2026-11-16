import CryptoKit
import DeviceCheck
import ExpoModulesCore
import LocalAuthentication
import Security

/// Secure Enclave signing key and App Attest, exposed to JavaScript.
///
/// The signing key is a non-exportable P-256 key generated inside the Secure
/// Enclave. Its access control can require the current biometric set, so the
/// operating system (not JavaScript) enforces Face ID before the key is used.
/// A drive "session" is one evaluated LAContext that is passed to every
/// signing call until the drive ends, so the user authenticates once per drive.
public class SecureEnclaveModule: Module {
  private var session: LAContext?

  public func definition() -> ModuleDefinition {
    Name("SecureEnclave")

    // MARK: Signing key

    Function("isSupported") { () -> Bool in
      SecureEnclave.isAvailable
    }

    /// Creates (replacing any existing) a Secure Enclave key under `tag`.
    /// Returns the public key as hex: 0x04 ‖ x ‖ y (65 bytes).
    AsyncFunction("createKey") { (tag: String, requireBiometry: Bool) throws -> String in
      guard SecureEnclave.isAvailable else { throw SecureEnclaveUnavailableException() }
      Self.deleteKey(tag: tag)

      var flags: SecAccessControlCreateFlags = [.privateKeyUsage]
      if requireBiometry { flags.insert(.biometryCurrentSet) }

      var error: Unmanaged<CFError>?
      // AfterFirstUnlock so a drive can keep signing while the phone is locked in a mount.
      guard let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        flags,
        &error
      ) else {
        throw KeychainException(Self.describe(error))
      }

      let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: Data(tag.utf8),
          kSecAttrAccessControl as String: access,
        ],
      ]

      guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
        throw KeychainException(Self.describe(error))
      }
      return try Self.publicKeyHex(of: privateKey)
    }

    /// The public key for `tag`, or nil if no key exists. Does not require authentication.
    Function("getPublicKey") { (tag: String) throws -> String? in
      guard let privateKey = try Self.loadKey(tag: tag, context: nil) else { return nil }
      return try Self.publicKeyHex(of: privateKey)
    }

    Function("deleteKey") { (tag: String) -> Bool in
      Self.deleteKey(tag: tag)
    }

    // MARK: Drive session (biometric)

    /// Prompts for Face ID / Touch ID once and keeps the authenticated context for signing.
    AsyncFunction("beginSession") { (reason: String) async throws in
      let context = LAContext()
      context.localizedFallbackTitle = "" // biometrics only, matching the key's access control
      do {
        _ = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
      } catch {
        throw BiometricException(error.localizedDescription)
      }
      self.session?.invalidate()
      self.session = context
    }

    Function("endSession") {
      self.session?.invalidate()
      self.session = nil
    }

    Function("hasSession") { () -> Bool in
      self.session != nil
    }

    /// Signs a 32-byte digest (hex) with ECDSA P-256. Returns the DER-encoded signature as hex.
    /// The digest is signed as-is (no further hashing), matching OpenZeppelin's P256.verify.
    AsyncFunction("sign") { (tag: String, digestHex: String) throws -> String in
      guard let context = self.session else { throw NoSessionException() }
      guard let digest = Data(hexString: digestHex), digest.count == 32 else {
        throw InvalidDigestException()
      }
      guard let privateKey = try Self.loadKey(tag: tag, context: context) else {
        throw KeyNotFoundException(tag)
      }

      var error: Unmanaged<CFError>?
      guard let signature = SecKeyCreateSignature(
        privateKey,
        .ecdsaSignatureDigestX962SHA256,
        digest as CFData,
        &error
      ) as Data? else {
        throw KeychainException(Self.describe(error))
      }
      return "0x" + signature.hexString
    }

    // MARK: App Attest

    Function("isAppAttestSupported") { () -> Bool in
      DCAppAttestService.shared.isSupported
    }

    /// Generates an App Attest key and returns its identifier (base64).
    AsyncFunction("generateAppAttestKey") { () async throws -> String in
      guard DCAppAttestService.shared.isSupported else { throw AppAttestUnavailableException() }
      return try await DCAppAttestService.shared.generateKey()
    }

    /// Asks Apple to attest `keyId`, committing to `clientDataHash` (base64, 32 bytes).
    /// Returns the attestation object (CBOR) as base64.
    AsyncFunction("attestKey") { (keyId: String, clientDataHashBase64: String) async throws -> String in
      guard DCAppAttestService.shared.isSupported else { throw AppAttestUnavailableException() }
      guard let clientDataHash = Data(base64Encoded: clientDataHashBase64), clientDataHash.count == 32 else {
        throw InvalidDigestException()
      }
      let attestation = try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash)
      return attestation.base64EncodedString()
    }
  }

  // MARK: - Keychain helpers

  private static func loadKey(tag: String, context: LAContext?) throws -> SecKey? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: Data(tag.utf8),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecReturnRef as String: true,
    ]
    if let context {
      query[kSecUseAuthenticationContext as String] = context
    }

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let item else {
      throw KeychainException("SecItemCopyMatching failed: \(status)")
    }
    return (item as! SecKey)
  }

  @discardableResult
  private static func deleteKey(tag: String) -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: Data(tag.utf8),
    ]
    return SecItemDelete(query as CFDictionary) == errSecSuccess
  }

  private static func publicKeyHex(of privateKey: SecKey) throws -> String {
    var error: Unmanaged<CFError>?
    guard let publicKey = SecKeyCopyPublicKey(privateKey),
          let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
          raw.count == 65 else {
      throw KeychainException(describe(error))
    }
    return "0x" + raw.hexString
  }

  private static func describe(_ error: Unmanaged<CFError>?) -> String {
    guard let error else { return "unknown error" }
    return (error.takeRetainedValue() as Error).localizedDescription
  }
}

// MARK: - Exceptions

final class SecureEnclaveUnavailableException: Exception {
  override var reason: String { "The Secure Enclave is not available on this device" }
}

final class AppAttestUnavailableException: Exception {
  override var reason: String { "App Attest is not supported on this device" }
}

final class NoSessionException: Exception {
  override var reason: String { "No authenticated drive session. Call beginSession first." }
}

final class InvalidDigestException: Exception {
  override var reason: String { "Expected a 32-byte value" }
}

final class KeyNotFoundException: GenericException<String> {
  override var reason: String { "No Secure Enclave key with tag \(param)" }
}

final class KeychainException: GenericException<String> {
  override var reason: String { "Keychain error: \(param)" }
}

final class BiometricException: GenericException<String> {
  override var reason: String { "Biometric authentication failed: \(param)" }
}

// MARK: - Hex

private extension Data {
  init?(hexString: String) {
    let hex = hexString.hasPrefix("0x") ? String(hexString.dropFirst(2)) : hexString
    guard hex.count % 2 == 0 else { return nil }
    var data = Data(capacity: hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
      data.append(byte)
      index = next
    }
    self = data
  }

  var hexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
