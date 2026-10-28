import AppKit
import CryptoKit
import LocalAuthentication
import Security

/// Optional Touch ID lock, and the master key kept without any Keychain prompt.
///
/// The engine's master key (it decrypts the mail passwords and API keys) is sealed by a key in
/// the Mac's Secure Enclave and kept in `master.sealed`. It is read from the Keychain only once,
/// to seal it, so the Keychain never asks for the password again.
/// - Lock off (default): the Secure Enclave key opens the sealed key silently.
/// - Lock on (Settings → Security): that key is usable only after Touch ID (or the Apple Watch,
///   or the Mac's password), so until the person unlocks, the engine has no key and cannot open
///   the mailboxes. The window shows « ZMail is locked » meanwhile.
@MainActor
final class AppLock {
    static let shared = AppLock()

    enum State { case locked, unlocking, unlocked }

    static let enabledKey = "ZMailTouchIDLock"
    /// Off by default; turned on in Settings → Security.
    private(set) var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: Self.enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
    }
    var available: Bool { SecureEnclave.isAvailable }
    var active: Bool { enabled && available }
    var biometry: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .touchID: return "touchID"
        case .faceID: return "faceID"
        case .opticID: return "opticID"
        default: return "none"
        }
    }

    /// Where the sealed key is kept (the app's data folder); set at launch.
    var dataDir: URL?
    var onStateChange: ((State) -> Void)?
    /// Called after the lock was turned on or off (the menu shows « Lock ZMail » only when on).
    var onEnabledChange: (() -> Void)?

    private(set) var state: State
    /// True while ZMail waits on the person (a Touch ID prompt, or the lock screen) for the key.
    var awaitingUser: Bool { prompting || (key == nil && active && state != .unlocked) }
    private var prompting = false
    private var key: Data?
    private var waiters: [CheckedContinuation<Data, Error>] = []

    private init() {
        state = UserDefaults.standard.bool(forKey: Self.enabledKey) && SecureEnclave.isAvailable ? .locked : .unlocked
    }

    /// The master key for the engine. Locked: waits until the person unlocks.
    func masterKey() async throws -> Data {
        if let key, !active || state == .unlocked { return key }
        if !active {
            let key = try await openWithoutLock()
            self.key = key
            return key
        }
        return try await withCheckedThrowingContinuation { continuation in
            waiters.append(continuation)
            if state == .locked { Task { await self.unlock() } }
        }
    }

    /// Asks for Touch ID, then opens the sealed key. A cancelled prompt leaves ZMail locked,
    /// with its « Unlock » button.
    func unlock() async {
        guard active, state != .unlocking else {
            if !active { set(.unlocked) }
            return
        }
        set(.unlocking)
        let context = LAContext()
        context.localizedCancelTitle = L10n.tr("Annuler", "Cancel")
        prompting = true
        defer { prompting = false }
        do {
            try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: L10n.tr("déverrouiller vos mails", "unlock your mail"))
        } catch {
            set(.locked)
            return
        }
        do {
            let key = try self.key ?? openLocked(context: context)
            self.key = key
            set(.unlocked)
            resumeWaiters(.success(key))
        } catch {
            NSLog("[zmail] unlock failed: \(error)")
            set(.locked)
            resumeWaiters(.failure(error))
        }
    }

    /// Hides the mail behind the lock again (the engine keeps its key and keeps syncing).
    func lock() {
        guard active, state == .unlocked else { return }
        set(.locked)
    }

    /// Turns the lock on or off, from the settings. Both ways ask for Touch ID first: turning it
    /// on proves it works, turning it off must not be open to whoever sits at an unlocked Mac.
    func setEnabled(_ on: Bool) async -> Bool {
        guard available, on != enabled else { return enabled == on }
        let context = LAContext()
        let reason = on ? L10n.tr("activer le verrouillage de ZMail", "turn on the ZMail lock") : L10n.tr("désactiver le verrouillage de ZMail", "turn off the ZMail lock")
        guard (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) == true else { return false }
        do {
            // The key is in memory as soon as the engine has started; reseal it for the new mode.
            let key: Data
            if let cached = self.key { key = cached } else if enabled { key = try openLocked(context: context) } else { key = try await openWithoutLock() }
            try reseal(key, requiresUser: on)
            self.key = key
        } catch {
            NSLog("[zmail] lock change failed: \(error)")
            return false
        }
        enabled = on
        set(.unlocked)
        onEnabledChange?()
        return true
    }

    private func set(_ next: State) {
        state = next
        onStateChange?(next)
    }

    private func resumeWaiters(_ result: Result<Data, Error>) {
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume(with: result) }
    }

    // MARK: Sealed key

    private var sealedURL: URL? { dataDir?.appendingPathComponent("master.sealed") }
    private var sealed: Data? { sealedURL.flatMap { try? Data(contentsOf: $0) } }

    /// Lock off: no prompt at all once sealed. Sealed with Touch ID earlier: one Touch ID to reseal.
    private func openWithoutLock() async throws -> Data {
        guard available else { return try KeychainStore.masterKey() }
        if let data = sealed, let requiresUser = try? SealedKey.requiresUser(data) {
            do {
                if !requiresUser { return try SealedKey.open(data, context: nil) }
                let context = LAContext()
                prompting = true
                defer { prompting = false }
                try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: L10n.tr("ouvrir ZMail", "open ZMail"))
                let key = try SealedKey.open(data, context: context)
                try reseal(key, requiresUser: false)
                return key
            } catch {
                NSLog("[zmail] sealed key unreadable, resealing from the Keychain: \(error)")
            }
        }
        let key = try KeychainStore.masterKey()
        try? reseal(key, requiresUser: false)
        return key
    }

    /// Lock on, `context` already authenticated.
    private func openLocked(context: LAContext) throws -> Data {
        if let data = sealed {
            do {
                let key = try SealedKey.open(data, context: context)
                if (try? SealedKey.requiresUser(data)) == false { try reseal(key, requiresUser: true) }
                return key
            } catch {
                // A Secure Enclave key does not survive a system reinstall: fall back to the Keychain.
                NSLog("[zmail] sealed key unreadable, resealing from the Keychain: \(error)")
            }
        }
        let key = try KeychainStore.masterKey()
        try reseal(key, requiresUser: true)
        return key
    }

    private func reseal(_ key: Data, requiresUser: Bool) throws {
        guard let url = sealedURL else { return }
        try SealedKey.seal(key, requiresUser: requiresUser).write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

/// The master key encrypted (AES-GCM) with a secret only the Secure Enclave key can derive (ECDH),
/// and that key usable only after the device owner authenticates.
enum SealedKey {
    private struct File: Codable {
        var version = 1
        var enclaveKey: Data
        var ephemeralPublicKey: Data
        var box: Data
        /// Absent in the first sealed files, which always required Touch ID.
        var requiresUser: Bool?
    }

    static func requiresUser(_ data: Data) throws -> Bool {
        try JSONDecoder().decode(File.self, from: data).requiresUser ?? true
    }

    static func seal(_ secret: Data, requiresUser: Bool) throws -> Data {
        var error: Unmanaged<CFError>?
        let flags: SecAccessControlCreateFlags = requiresUser ? [.privateKeyUsage, .userPresence] : [.privateKeyUsage]
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &error) else {
            throw error!.takeRetainedValue() as Error
        }
        let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
        let ephemeral = P256.KeyAgreement.PrivateKey()
        let symmetric = derive(try ephemeral.sharedSecretFromKeyAgreement(with: enclave.publicKey))
        guard let box = try AES.GCM.seal(secret, using: symmetric).combined else { throw CocoaError(.coderInvalidValue) }
        return try JSONEncoder().encode(File(enclaveKey: enclave.dataRepresentation, ephemeralPublicKey: ephemeral.publicKey.rawRepresentation, box: box, requiresUser: requiresUser))
    }

    /// `context` has already authenticated the person (no second prompt); nil without the lock.
    static func open(_ data: Data, context: LAContext?) throws -> Data {
        let file = try JSONDecoder().decode(File.self, from: data)
        let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: file.enclaveKey, authenticationContext: context)
        let symmetric = derive(try enclave.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(rawRepresentation: file.ephemeralPublicKey)))
        return try AES.GCM.open(AES.GCM.SealedBox(combined: file.box), using: symmetric)
    }

    private static func derive(_ secret: SharedSecret) -> SymmetricKey {
        secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data("zmail-master-key".utf8), sharedInfo: Data(), outputByteCount: 32)
    }
}

/// Shown over the window while ZMail is locked: one button, Touch ID does the rest.
final class LockView: NSVisualEffectView {
    var onUnlock: (() -> Void)?
    private let button = NSButton()
    private let subtitle = NSTextField(labelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        material = .underWindowBackground
        blendingMode = .withinWindow
        state = .active

        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.widthAnchor.constraint(equalToConstant: 88).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 88).isActive = true

        let title = NSTextField(labelWithString: L10n.tr("ZMail est verrouillé", "ZMail is locked"))
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textColor = .secondaryLabelColor
        subtitle.alignment = .center

        button.title = L10n.tr("Déverrouiller avec Touch ID", "Unlock with Touch ID")
        button.image = NSImage(systemSymbolName: "touchid", accessibilityDescription: nil)
        button.imagePosition = .imageLeading
        button.bezelStyle = .push
        button.controlSize = .large
        button.keyEquivalent = "\r"
        button.target = self
        button.action = #selector(unlockClicked)

        let stack = NSStackView(views: [icon, title, subtitle, button])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.setCustomSpacing(18, after: icon)
        stack.setCustomSpacing(20, after: subtitle)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: centerXAnchor), stack.centerYAnchor.constraint(equalTo: centerYAnchor)])
        show(unlocking: false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(unlocking: Bool) {
        subtitle.stringValue = unlocking
            ? L10n.tr("Posez votre doigt sur Touch ID…", "Touch the Touch ID sensor…")
            : L10n.tr("Vos mails, mots de passe et clés restent chiffrés tant que ZMail est verrouillé.", "Your mail, passwords and keys stay encrypted while ZMail is locked.")
        button.isEnabled = !unlocking
    }

    @objc private func unlockClicked() { onUnlock?() }
}
