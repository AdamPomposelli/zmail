import Foundation
import FoundationModels

/// On-device generation through Apple's FoundationModels framework.
/// Each request gets a fresh `LanguageModelSession`; at most 2 run concurrently.
actor AIService {
    enum Outcome: Sendable {
        case text(String)
        case unavailable(reason: String)
        case failed(code: String, message: String)
    }

    private let maxInFlight = 2
    private var inFlight = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    nonisolated func availability() -> (available: Bool, reason: String?) {
        switch SystemLanguageModel.default.availability {
        case .available:
            return (true, nil)
        case .unavailable(let reason):
            return (false, Self.describe(reason))
        }
    }

    /// What FoundationModels does not say: the language settings that make macOS withhold
    /// the model. macOS requires Siri and the Mac to use the same language.
    nonisolated func diagnostics() -> [String: Any] {
        let system = Locale.preferredLanguages.first ?? Locale.current.identifier
        let siri = CFPreferencesCopyAppValue("Session Language" as CFString, "com.apple.assistant.backedup" as CFString) as? String
        let code = { (id: String) in Locale(identifier: id).language.languageCode?.identifier }
        var result: [String: Any] = [
            "systemLanguage": system,
            "systemLanguageName": Self.languageName(system),
            "systemLanguageSupported": SystemLanguageModel.default.supportsLocale(Locale(identifier: system)),
        ]
        if let siri {
            result["siriLanguage"] = siri
            result["siriLanguageName"] = Self.languageName(siri)
            result["languagesMatch"] = code(system) == code(siri)
        } else {
            result["siriLanguage"] = NSNull()
            result["languagesMatch"] = NSNull()
        }
        return result
    }

    private static func languageName(_ id: String) -> String {
        Locale(identifier: "fr_FR").localizedString(forIdentifier: id) ?? id
    }

    func generate(system: String?, prompt: String, temperature: Double?, maxTokens: Int?) async -> Outcome {
        let state = availability()
        guard state.available else { return .unavailable(reason: state.reason ?? "unknown") }

        await acquire()
        defer { release() }

        let options = GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)
        let session: LanguageModelSession
        if let system, !system.isEmpty {
            session = LanguageModelSession(instructions: system)
        } else {
            session = LanguageModelSession()
        }
        do {
            let response = try await session.respond(to: prompt, options: options)
            return .text(response.content)
        } catch let error as LanguageModelSession.GenerationError {
            return .failed(code: Self.code(for: error), message: error.localizedDescription)
        } catch {
            return .failed(code: "generation_failed", message: error.localizedDescription)
        }
    }

    private func acquire() async {
        if inFlight < maxInFlight {
            inFlight += 1
            return
        }
        await withCheckedContinuation { waiters.append($0) }
        // The releaser handed its slot over; inFlight was not decremented.
    }

    private func release() {
        if waiters.isEmpty {
            inFlight -= 1
        } else {
            waiters.removeFirst().resume()
        }
    }

    private static func code(for error: LanguageModelSession.GenerationError) -> String {
        switch error {
        case .exceededContextWindowSize: "context_window_exceeded"
        case .guardrailViolation: "guardrail_violation"
        case .unsupportedLanguageOrLocale: "unsupported_language"
        case .assetsUnavailable: "assets_unavailable"
        case .rateLimited: "rate_limited"
        case .concurrentRequests: "concurrent_requests"
        case .refusal: "refusal"
        default: "generation_failed"
        }
    }

    private static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible: "deviceNotEligible"
        case .appleIntelligenceNotEnabled: "appleIntelligenceNotEnabled"
        case .modelNotReady: "modelNotReady"
        @unknown default: String(describing: reason)
        }
    }
}
