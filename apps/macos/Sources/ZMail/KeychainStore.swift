import Foundation
import Security

/// Generic-password access to the login Keychain for the engine's master key.
enum KeychainStore {
    /// `ZMAIL_KEYCHAIN_SERVICE` exists only so tests don't touch the real item.
    static let service = ProcessInfo.processInfo.environment["ZMAIL_KEYCHAIN_SERVICE"] ?? "com.zippy.zmail"
    static let masterKeyAccount = "master-key"

    enum KeychainError: Error, CustomStringConvertible {
        case status(OSStatus)
        case randomFailed
        var description: String {
            switch self {
            case .status(let s): (SecCopyErrorMessageString(s, nil) as String?) ?? "OSStatus \(s)"
            case .randomFailed: "SecRandomCopyBytes failed"
            }
        }
    }

    /// Serializes read-or-create so concurrent first calls can't mint two keys.
    private static let lock = NSLock()

    /// Returns the 32-byte master key, creating and storing it on first use.
    static func masterKey() throws -> Data {
        lock.lock(); defer { lock.unlock() }
        if let existing = try read(account: masterKeyAccount) { return existing }

        var bytes = Data(count: 32)
        let rc = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard rc == errSecSuccess else { throw KeychainError.randomFailed }

        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: masterKeyAccount,
            kSecAttrLabel as String: "ZMail master key",
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: bytes,
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem, let existing = try read(account: masterKeyAccount) {
            return existing
        }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
        return bytes
    }

    private static func read(account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: return result as? Data
        case errSecItemNotFound: return nil
        default: throw KeychainError.status(status)
        }
    }
}
