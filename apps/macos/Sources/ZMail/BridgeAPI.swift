import AppKit
import Foundation

/// Routes for the native bridge. Every route requires `Authorization: Bearer <token>`.
final class BridgeAPI: Sendable {
    let token: String
    let ai: AIService
    let notifications: NotificationManager

    init(token: String, ai: AIService, notifications: NotificationManager) {
        self.token = token
        self.ai = ai
        self.notifications = notifications
    }

    func handle(_ req: HTTPRequest) async -> HTTPResponse {
        // CORS so the web UI (another loopback origin) may call the bridge directly.
        let origin = req.header("origin")
        var response: HTTPResponse
        if req.method == "OPTIONS" {
            response = HTTPResponse(status: 204)
        } else if !authorized(req) {
            response = .error(401, "unauthorized")
        } else {
            response = await route(req)
        }
        if let origin, Self.isLoopbackOrigin(origin) {
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Max-Age"] = "600"
            response.headers["Vary"] = "Origin"
        }
        return response
    }

    private func route(_ req: HTTPRequest) async -> HTTPResponse {
        switch (req.method, req.path) {
        case ("GET", "/health"): return await health()
        case ("POST", "/ai/generate"): return await generate(req)
        case ("POST", "/notify"): return await notify(req)
        case ("GET", "/keychain/master-key"): return await masterKey()
        case ("POST", "/badge"): return await badge(req)
        case ("GET", "/lock"): return await lockStatus()
        case ("POST", "/lock"): return await setLock(req)
        case ("POST", "/lock/now"): return await MainActor.run { AppLock.shared.lock(); return .json(200, ["ok": true]) }
        case (_, "/health"), (_, "/ai/generate"), (_, "/notify"), (_, "/keychain/master-key"), (_, "/badge"):
            return .error(405, "method_not_allowed")
        default:
            return .error(404, "not_found")
        }
    }

    private func authorized(_ req: HTTPRequest) -> Bool {
        guard let header = req.header("authorization"), header.hasPrefix("Bearer ") else { return false }
        return Self.constantTimeEquals(String(header.dropFirst(7)), token)
    }

    // MARK: Routes

    private func health() async -> HTTPResponse {
        let state = ai.availability()
        await notifications.refreshStatus() // picks up changes made in System Settings
        let status = await notifications.status
        return .json(200, [
            "ok": true,
            "ai": ["available": state.available, "reason": state.reason ?? NSNull(), "diagnostics": ai.diagnostics()] as [String: Any],
            "notifications": status,
        ])
    }

    private func generate(_ req: HTTPRequest) async -> HTTPResponse {
        guard let body = req.jsonObject(), let prompt = body["prompt"] as? String, !prompt.isEmpty else {
            return .error(400, "invalid_body", reason: "prompt is required")
        }
        let system = body["system"] as? String
        let temperature = (body["temperature"] as? NSNumber)?.doubleValue
        let maxTokens = (body["maxTokens"] as? NSNumber)?.intValue
        switch await ai.generate(system: system, prompt: prompt, temperature: temperature, maxTokens: maxTokens) {
        case .text(let text):
            return .json(200, ["text": text])
        case .unavailable(let reason):
            return .error(503, "unavailable", reason: reason)
        case .failed(let code, let message):
            let status = code == "assets_unavailable" || code == "rate_limited" || code == "concurrent_requests" ? 503 : 422
            return .json(status, ["error": code, "message": message])
        }
    }

    private func notify(_ req: HTTPRequest) async -> HTTPResponse {
        guard let body = req.jsonObject(),
              let title = body["title"] as? String,
              let text = body["body"] as? String else {
            return .error(400, "invalid_body", reason: "title and body are required")
        }
        let allowedKinds: Set<String> = ["otp", "priority", "opportunity", "rule", "unsubscribe_failed", "info"]
        let kind = (body["kind"] as? String).flatMap { allowedKinds.contains($0) ? $0 : nil } ?? "info"
        let payload = NotificationPayload(
            id: (body["id"] as? String) ?? UUID().uuidString,
            title: title,
            subtitle: body["subtitle"] as? String,
            body: text,
            kind: kind,
            otp: body["otp"] as? String,
            threadId: body["threadId"] as? String)
        do {
            let delivered = try await notifications.post(payload)
            return .json(200, ["ok": true, "delivered": delivered])
        } catch is NotificationManager.NotAuthorized {
            return .json(409, ["error": "notifications_denied", "message": "macOS notifications are turned off for ZMail"])
        } catch {
            return .json(500, ["error": "notify_failed", "message": error.localizedDescription])
        }
    }

    /// Answers once ZMail is unlocked (Touch ID): until then the engine waits without a key.
    private func masterKey() async -> HTTPResponse {
        do {
            return .json(200, ["key": try await AppLock.shared.masterKey().base64EncodedString()])
        } catch {
            return .json(500, ["error": "keychain_failed", "message": String(describing: error)])
        }
    }

    /// For Settings → Security: is Touch ID there, and is the lock on.
    private func lockStatus() async -> HTTPResponse {
        await MainActor.run {
            let lock = AppLock.shared
            return .json(200, ["available": lock.available, "enabled": lock.enabled, "biometry": lock.biometry])
        }
    }

    private func setLock(_ req: HTTPRequest) async -> HTTPResponse {
        guard let enabled = req.jsonObject()?["enabled"] as? Bool else { return .error(400, "invalid_body", reason: "enabled is required") }
        let done = await AppLock.shared.setEnabled(enabled)
        let now = await MainActor.run { AppLock.shared.enabled }
        return .json(200, ["ok": done, "enabled": now])
    }

    private func badge(_ req: HTTPRequest) async -> HTTPResponse {
        guard let count = (req.jsonObject()?["count"] as? NSNumber)?.intValue else {
            return .error(400, "invalid_body", reason: "count is required")
        }
        await MainActor.run { DockBadge.set(count) }
        return .json(200, ["ok": true])
    }

    // MARK: Helpers

    private static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }

    private static func isLoopbackOrigin(_ origin: String) -> Bool {
        guard let url = URL(string: origin), url.scheme == "http" else { return false }
        return url.host == "127.0.0.1" || url.host == "localhost"
    }
}

@MainActor
enum DockBadge {
    /// Last count shown, also displayed in the Zippy bar's ZMail panel.
    @MainActor static var current = 0
    @MainActor static func set(_ count: Int) {
        current = count
        NSApp.dockTile.badgeLabel = count > 0 ? (count > 99 ? "99+" : String(count)) : ""
    }
}
