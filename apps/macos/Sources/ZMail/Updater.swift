import AppKit
import Foundation

/// Keeps ZMail up to date from its GitHub releases, without asking anything until the end:
/// it checks the latest release, downloads it in the background, checks it is the same app
/// signed by the same identity, and keeps it ready. "Restart to update" (or simply quitting)
/// swaps the bundle in place and, on restart, opens the new version.
///
/// The web UI follows every step through `zmail:update` events (sidebar footer) and asks for
/// the current state with `getUpdateState`. Set ZMAIL_UPDATE_FEED to a release JSON to test
/// against a local feed.
@MainActor
final class Updater: NSObject {
    static let shared = Updater()

    enum Phase: String { case idle, checking, upToDate, downloading, preparing, ready, failed, manual }

    private(set) var phase: Phase = .idle
    private(set) var version: String?
    private(set) var progress: Double = 0
    private(set) var error: String?
    private var releaseURL: URL?
    private var staged: URL?
    private var installing = false
    private var timer: Timer?
    private var download: URLSessionDownloadTask?
    private var expectedBytes: Int64 = 0

    /// Called with the state as JSON whenever it changes (the window forwards it to the page).
    var onChange: ((String) -> Void)?

    private let feed = URL(string: ProcessInfo.processInfo.environment["ZMAIL_UPDATE_FEED"] ?? "https://api.github.com/repos/AdamPomposelli/zmail/releases/latest")!
    private var current: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }
    /// Only a real ZMail.app updates itself (not `swift run` during development).
    private var updatable: Bool { Bundle.main.bundleURL.pathExtension == "app" && Bundle.main.bundleIdentifier != nil }
    private var updatesDir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ZMail/Updates", isDirectory: true)
    }

    // MARK: Schedule

    /// First check shortly after launch (the engine starts first), then every four hours.
    func start() {
        guard updatable else { return }
        try? FileManager.default.removeItem(at: updatesDir)
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.check(userInitiated: false) }
        timer = Timer.scheduledTimer(withTimeInterval: 4 * 3600, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.check(userInitiated: false) }
        }
    }

    /// `userInitiated`: from the menu; says "up to date" for a moment instead of staying silent.
    func check(userInitiated: Bool) {
        guard updatable, [.idle, .upToDate, .failed, .manual].contains(phase) else { return }
        set(.checking, quiet: !userInitiated)
        Task {
            do {
                var request = URLRequest(url: feed, timeoutInterval: 20)
                request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
                let (data, _) = try await URLSession.shared.data(for: request)
                guard let release = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let tag = release["tag_name"] as? String else { throw UpdateError.feed }
                let latest = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
                releaseURL = (release["html_url"] as? String).flatMap(URL.init(string:))
                guard Self.isNewer(latest, than: current) else {
                    set(userInitiated ? .upToDate : .idle)
                    if userInitiated { DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in if self?.phase == .upToDate { self?.set(.idle) } } }
                    return
                }
                let assets = release["assets"] as? [[String: Any]] ?? []
                let asset = ["ZMail.zip", "ZMail.dmg"].lazy.compactMap { name in assets.first { $0["name"] as? String == name } }.first
                guard let asset, let link = (asset["browser_download_url"] as? String).flatMap(URL.init(string:)) else { throw UpdateError.noAsset }
                version = latest
                guard canReplaceApp else { set(.manual); return }
                expectedBytes = (asset["size"] as? NSNumber)?.int64Value ?? 0
                startDownload(link)
            } catch {
                fail(error, quiet: !userInitiated)
            }
        }
    }

    // MARK: Download and prepare

    private func startDownload(_ url: URL) {
        progress = 0
        set(.downloading)
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
        download = session.downloadTask(with: url)
        download?.resume()
    }

    fileprivate func downloaded(to file: URL, name: String) {
        set(.preparing)
        let version = self.version ?? "new"
        Task.detached { [updatesDir = self.updatesDir] in
            do {
                let dir = updatesDir.appendingPathComponent(version, isDirectory: true)
                try? FileManager.default.removeItem(at: dir)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let archive = dir.appendingPathComponent(name)
                try FileManager.default.moveItem(at: file, to: archive)
                let app = try Self.unpack(archive, into: dir)
                try await Self.verify(app, version: version)
                await MainActor.run { self.staged = app; self.set(.ready) }
            } catch {
                await MainActor.run { self.fail(error, quiet: false) }
            }
        }
    }

    /// Unzips (ditto) or copies the app out of the disk image.
    nonisolated private static func unpack(_ archive: URL, into dir: URL) throws -> URL {
        let out = dir.appendingPathComponent("ZMail.app")
        if archive.pathExtension == "zip" {
            try run("/usr/bin/ditto", ["-x", "-k", archive.path, dir.path])
        } else {
            let mount = dir.appendingPathComponent("mnt").path
            try run("/usr/bin/hdiutil", ["attach", archive.path, "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount])
            defer { _ = try? run("/usr/bin/hdiutil", ["detach", mount, "-force"]) }
            try run("/usr/bin/ditto", [mount + "/ZMail.app", out.path])
        }
        guard FileManager.default.fileExists(atPath: out.path) else { throw UpdateError.noApp }
        return out
    }

    /// The new bundle must be ZMail, at the announced version, signed like the running one.
    nonisolated private static func verify(_ app: URL, version: String) async throws {
        let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
        guard info?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              info?["CFBundleShortVersionString"] as? String == version else { throw UpdateError.notZMail }
        try run("/usr/bin/codesign", ["--verify", app.path])
        // Same signer: the new app must satisfy the running app's designated requirement
        // (skipped for an ad hoc build, whose requirement is its own hash).
        let requirement = (try? run("/usr/bin/codesign", ["-d", "-r-", Bundle.main.bundlePath]))?
            .components(separatedBy: "\n").first { $0.hasPrefix("designated => ") }?
            .replacingOccurrences(of: "designated => ", with: "")
        if let requirement, !requirement.hasPrefix("cdhash") {
            do { try run("/usr/bin/codesign", ["--verify", "-R=\(requirement)", app.path]) } catch { throw UpdateError.signature }
        }
    }

    // MARK: Install

    /// Writable bundle and folder: an app in /Applications installed by drag and drop is.
    private var canReplaceApp: Bool {
        let bundle = Bundle.main.bundleURL
        return FileManager.default.isWritableFile(atPath: bundle.deletingLastPathComponent().path) && FileManager.default.isWritableFile(atPath: bundle.path)
    }

    /// "Restart to update": swap the bundle once ZMail has quit, then open the new one.
    func installAndRelaunch() {
        if phase == .manual, let releaseURL { NSWorkspace.shared.open(releaseURL); return }
        guard phase == .ready else { return }
        guard install(relaunch: true) else { return }
        NSApp.terminate(nil)
    }

    /// Quitting with an update ready installs it silently: the next launch is the new version.
    func installOnQuit() {
        guard phase == .ready, !installing else { return }
        _ = install(relaunch: false)
    }

    private func install(relaunch: Bool) -> Bool {
        guard let staged, !installing else { return false }
        let target = Bundle.main.bundleURL.path
        let script = """
        while kill -0 \(getpid()) 2>/dev/null; do sleep 0.2; done
        T="$1"; N="$2"
        rm -rf "$T.old"
        if mv "$T" "$T.old" && /usr/bin/ditto "$N" "$T"; then rm -rf "$T.old"; else rm -rf "$T"; mv "$T.old" "$T"; fi
        /usr/bin/xattr -dr com.apple.quarantine "$T" 2>/dev/null
        rm -rf "$(dirname "$N")"
        \(relaunch ? "/usr/bin/open \"$T\"" : "")
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "zmail-update", target, staged.path]
        do {
            try process.run()
            installing = true
            return true
        } catch {
            fail(error, quiet: false)
            return false
        }
    }

    // MARK: State

    private func set(_ next: Phase, quiet: Bool = false) {
        phase = next
        if next != .failed { error = nil }
        if !quiet || next != .checking { publish() }
    }

    private func fail(_ err: Error, quiet: Bool) {
        error = (err as? UpdateError)?.message ?? err.localizedDescription
        phase = quiet ? .idle : .failed
        NSLog("ZMail update: \(error ?? "")")
        publish()
    }

    /// The state the web UI shows: `{ phase, version, progress, error }`.
    func stateJSON() -> String {
        var state: [String: Any] = ["phase": phase.rawValue, "current": current, "progress": progress]
        if let version { state["version"] = version }
        if let error { state["error"] = error }
        let data = (try? JSONSerialization.data(withJSONObject: state)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    func publish() { onChange?(stateJSON()) }

    // MARK: Helpers

    /// 0.1.10 is newer than 0.1.9: numeric, part by part.
    nonisolated static func isNewer(_ a: String, than b: String) -> Bool {
        let parts = { (s: String) in s.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 } }
        let (x, y) = (parts(a), parts(b))
        for i in 0..<max(x.count, y.count) {
            let (l, r) = (i < x.count ? x[i] : 0, i < y.count ? y[i] : 0)
            if l != r { return l > r }
        }
        return false
    }

    @discardableResult
    nonisolated private static func run(_ tool: String, _ args: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw UpdateError.tool(tool, out) }
        return out
    }

    enum UpdateError: Error {
        case feed, noAsset, noApp, notZMail, signature, tool(String, String)
        var message: String {
            switch self {
            case .feed: L10n.tr("Réponse inattendue de GitHub.", "Unexpected answer from GitHub.")
            case .noAsset: L10n.tr("La dernière version n’a pas d’app à télécharger.", "The latest release has no app to download.")
            case .noApp: L10n.tr("ZMail.app introuvable dans le téléchargement.", "ZMail.app not found in the download.")
            case .notZMail: L10n.tr("Le téléchargement n’est pas la bonne version de ZMail.", "The download is not the expected ZMail version.")
            case .signature: L10n.tr("La signature de la mise à jour ne correspond pas.", "The update's signature does not match.")
            case let .tool(tool, out): "\((tool as NSString).lastPathComponent): \(out.prefix(200))"
            }
        }
    }
}

extension Updater: URLSessionDownloadDelegate {
    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten written: Int64, totalBytesExpectedToWrite total: Int64) {
        MainActor.assumeIsolated {
            let expected = total > 0 ? total : expectedBytes
            guard expected > 0 else { return }
            let next = min(1, Double(written) / Double(expected))
            // A few events a second are plenty for a progress bar.
            if next - progress >= 0.01 || next == 1 { progress = next; publish() }
        }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // The file is deleted when this returns: move it first.
        let name = downloadTask.originalRequest?.url?.lastPathComponent ?? "ZMail.zip"
        let keep = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + name)
        let moved = (try? FileManager.default.moveItem(at: location, to: keep)) != nil
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
        MainActor.assumeIsolated {
            guard moved, status < 400 else { fail(UpdateError.noApp, quiet: false); return }
            downloaded(to: keep, name: name)
        }
        session.finishTasksAndInvalidate()
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        MainActor.assumeIsolated { fail(error, quiet: false) }
        session.finishTasksAndInvalidate()
    }
}
