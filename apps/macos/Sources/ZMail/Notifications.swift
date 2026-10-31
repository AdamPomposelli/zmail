import AppKit
import UserNotifications

struct NotificationPayload: Sendable {
    var id: String
    var title: String
    var subtitle: String?
    var body: String
    var kind: String
    var otp: String?
    var threadId: String?
}

/// Local notifications. Uses UNUserNotificationCenter inside a real .app bundle,
/// and falls back to `osascript display notification` for unbundled dev runs
/// (UNUserNotificationCenter aborts without a bundle identifier).
@MainActor
final class NotificationManager: NSObject {
    static let otpCategory = "OTP"
    static let defaultCategory = "DEFAULT"
    static let copyOTPAction = "COPY_OTP"
    static let openAction = "OPEN"

    /// Called when the user opens a notification (thread id may be nil).
    var onOpen: ((String?) -> Void)?

    private(set) var status: String = "unavailable"
    let isBundled = Bundle.main.bundleIdentifier != nil

    private var center: UNUserNotificationCenter? {
        isBundled ? UNUserNotificationCenter.current() : nil
    }

    func setUp() {
        guard let center else { status = "unavailable"; return }
        center.delegate = self
        let copy = UNNotificationAction(identifier: Self.copyOTPAction, title: L10n.tr("Copier le code", "Copy code"), options: [])
        let open = UNNotificationAction(identifier: Self.openAction, title: L10n.tr("Ouvrir", "Open"), options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.otpCategory, actions: [copy, open], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.defaultCategory, actions: [open], intentIdentifiers: []),
        ])
        Task {
            await refreshStatus()
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            await refreshStatus()
        }
    }

    func refreshStatus() async {
        guard let center else { status = "unavailable"; return }
        let settings = await center.notificationSettings()
        status = switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: "authorized"
        case .denied: "denied"
        case .notDetermined: "notDetermined"
        @unknown default: "unavailable"
        }
    }

    struct NotAuthorized: LocalizedError {
        var errorDescription: String? { "notifications_denied" }
    }

    /// Shows a notification and says how: `card` (a code, on ZMail's floating card) or `native`.
    /// Throws `NotAuthorized` when macOS has ZMail's notifications turned off, so the engine knows.
    @discardableResult
    func post(_ payload: NotificationPayload) async throws -> String {
        // A code always goes on the floating card: visible at once, one click to copy, and it does
        // not depend on the notification permission.
        if payload.kind == "otp", let otp = payload.otp {
            CodeCard.shared.show(code: otp, title: payload.title, subtitle: payload.subtitle ?? Self.sender(of: payload.body), threadId: payload.threadId)
            return "card"
        }
        guard let center else {
            postViaAppleScript(payload)
            return "native"
        }
        await refreshStatus()
        guard status == "authorized" else { throw NotAuthorized() }
        let content = UNMutableNotificationContent()
        content.title = payload.title
        if let subtitle = payload.subtitle { content.subtitle = subtitle }
        content.body = payload.body
        // Codes arrive silently (they already show on the code card); other alerts keep the sound.
        content.sound = payload.kind == "otp" ? nil : .default
        var info: [String: String] = ["kind": payload.kind]
        if let threadId = payload.threadId { info["threadId"] = threadId; content.threadIdentifier = threadId }
        if payload.kind == "otp" {
            content.categoryIdentifier = Self.otpCategory
            if let otp = payload.otp { info["otp"] = otp }
        } else {
            content.categoryIdentifier = Self.defaultCategory
        }
        content.userInfo = info
        let request = UNNotificationRequest(identifier: payload.id, content: content, trigger: nil)
        try await center.add(request)
        return "native"
    }

    /// « Slash : Your verification code » → « Slash ».
    private static func sender(of body: String) -> String? {
        let name = body.components(separatedBy: " : ").first ?? body.components(separatedBy: ": ").first
        return name.flatMap { $0.count <= 40 ? $0 : nil }
    }

    private func postViaAppleScript(_ payload: NotificationPayload) {
        func quote(_ s: String) -> String {
            "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
        }
        var script = "display notification \(quote(payload.body)) with title \(quote(payload.title))"
        if let subtitle = payload.subtitle { script += " subtitle \(quote(subtitle))" }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        proc.arguments = ["-e", script]
        try? proc.run()
    }
}

extension NotificationManager: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let otp = info["otp"] as? String
        let threadId = info["threadId"] as? String
        let action = response.actionIdentifier
        await MainActor.run {
            switch action {
            case Self.copyOTPAction:
                if let otp { Pasteboard.copy(otp) }
            case UNNotificationDefaultActionIdentifier:
                // Clicking a code notification copies the code too: that is what people came for.
                if let otp { Pasteboard.copy(otp) }
                self.onOpen?(threadId)
            case Self.openAction:
                self.onOpen?(threadId)
            default:
                break
            }
        }
    }
}

@MainActor
enum Pasteboard {
    static func copy(_ text: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
    }
}
