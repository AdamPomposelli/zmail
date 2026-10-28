import Foundation

/// ZMail's language on the native side: the one the web UI last set (`setLocale` message),
/// else the Mac's. Same choice as the UI (lib/i18n.ts) and the engine.
enum L10n {
    static let key = "locale"
    static let didChange = Notification.Name("ZMailLocaleDidChange")

    static var code: String {
        if let saved = UserDefaults.standard.string(forKey: key), saved == "fr" || saved == "en" { return saved }
        return (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("fr") ? "fr" : "en"
    }

    static var isFrench: Bool { code == "fr" }

    /// The French text, or its English translation.
    static func tr(_ fr: String, _ en: String) -> String { isFrench ? fr : en }

    static func save(_ locale: String) {
        guard locale == "fr" || locale == "en", locale != UserDefaults.standard.string(forKey: key) else { return }
        UserDefaults.standard.set(locale, forKey: key)
        NotificationCenter.default.post(name: didChange, object: nil)
    }
}
