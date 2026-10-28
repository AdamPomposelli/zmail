import Foundation

/// Resolved locations of the engine script, UI bundle and node binary.
struct EnginePaths: Sendable {
    var node: URL
    var nodeArgsPrefix: [String] // e.g. ["node"] when launching through /usr/bin/env
    var engine: URL
    var uiDir: URL

    /// Order: explicit env override → app bundle resources → repo checkout (dev).
    static func resolve() -> EnginePaths {
        let env = ProcessInfo.processInfo.environment
        let fm = FileManager.default
        let resources = Bundle.main.resourceURL
        let repo = repoRoot()

        func firstExisting(_ candidates: [URL?]) -> URL? {
            candidates.compactMap { $0 }.first { fm.fileExists(atPath: $0.path) }
        }

        let engine = firstExisting([
            env["ZMAIL_ENGINE_PATH"].map { URL(fileURLWithPath: $0) },
            resources?.appendingPathComponent("engine/engine.mjs"),
            repo?.appendingPathComponent("apps/server/dist/engine.mjs"),
        ]) ?? (resources?.appendingPathComponent("engine/engine.mjs")
               ?? URL(fileURLWithPath: "engine.mjs"))

        let ui = firstExisting([
            env["ZMAIL_UI_DIR"].map { URL(fileURLWithPath: $0) },
            resources?.appendingPathComponent("ui"),
            repo?.appendingPathComponent("apps/mail/build/client"),
        ]) ?? (resources?.appendingPathComponent("ui") ?? URL(fileURLWithPath: "ui"))

        if let node = firstExisting([
            env["ZMAIL_NODE_PATH"].map { URL(fileURLWithPath: $0) },
            resources?.appendingPathComponent("node"),
        ]).flatMap({ fm.isExecutableFile(atPath: $0.path) ? $0 : nil }) ?? findNodeOnPath() {
            return EnginePaths(node: node, nodeArgsPrefix: [], engine: engine, uiDir: ui)
        }
        return EnginePaths(node: URL(fileURLWithPath: "/usr/bin/env"), nodeArgsPrefix: ["node"],
                           engine: engine, uiDir: ui)
    }

    /// The repo root, derived from this source file's location (dev builds only).
    private static func repoRoot() -> URL? {
        let url = URL(fileURLWithPath: #filePath) // apps/macos/Sources/ZMail/EngineProcess.swift
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("apps").path) ? url : nil
    }

    private static func findNodeOnPath() -> URL? {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser.path
        var dirs = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        dirs += ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.volta/bin", "\(home)/.local/share/fnm/aliases/default/bin"]
        // nvm: newest installed version first (GUI apps don't inherit the shell's PATH).
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? fm.contentsOfDirectory(atPath: nvm) {
            let sorted = versions.sorted { $0.compare($1, options: .numeric) == .orderedDescending }
            dirs += sorted.map { "\(nvm)/\($0)/bin" }
        }
        for dir in dirs {
            let candidate = URL(fileURLWithPath: dir).appendingPathComponent("node")
            if fm.isExecutableFile(atPath: candidate.path) { return candidate }
        }
        return nil
    }
}

/// Supervises the Node mail engine child process: launch, log, health-check,
/// restart with exponential backoff, and terminate on quit.
@MainActor
final class EngineProcess {
    enum State: Equatable { case idle, starting, running, failed(String) }

    let paths: EnginePaths
    let dataDir: URL
    let logURL: URL
    private(set) var port: UInt16 = 0
    private(set) var state: State = .idle

    var onStateChange: ((State) -> Void)?

    private let bridgeURL: String
    private let bridgeToken: String
    private var process: Process?
    private var stopping = false
    private var restartCount = 0
    private var lastLaunch = Date.distantPast

    init(dataDir: URL, bridgeURL: String, bridgeToken: String) {
        self.paths = EnginePaths.resolve()
        self.dataDir = dataDir
        self.bridgeURL = bridgeURL
        self.bridgeToken = bridgeToken
        let logs = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/ZMail", isDirectory: true)
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        self.logURL = logs.appendingPathComponent("engine.log")
    }

    var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    /// Launches the engine and waits for `/api/health` (up to `timeout` seconds).
    func start(timeout: TimeInterval = 30) async -> Bool {
        stopping = false
        launch()
        let ok = await waitForHealth(timeout: timeout)
        if ok { setState(.running) } else if case .starting = state {
            setState(.failed(L10n.tr("Le moteur ZMail ne répond pas. Journal : \(logURL.path)", "The ZMail engine is not responding. Log: \(logURL.path)")))
            // A slow start is not a dead one: keep watching, and recover as soon as it answers.
            Task { @MainActor in
                if await self.waitForHealth(timeout: 10 * 60), case .failed = self.state, self.process != nil { self.setState(.running) }
            }
        }
        return ok
    }

    func stop() {
        stopping = true
        guard let process, process.isRunning else { return }
        process.terminate() // SIGTERM
        let pid = process.processIdentifier
        let deadline = Date().addingTimeInterval(2)
        while process.isRunning && Date() < deadline { usleep(50_000) }
        if process.isRunning { kill(pid, SIGKILL) }
        self.process = nil
    }

    private func launch() {
        guard FileManager.default.fileExists(atPath: paths.engine.path) else {
            setState(.failed("Moteur introuvable : \(paths.engine.path)"))
            return
        }
        // Keep the same port across restarts so the web view keeps working.
        if port == 0 || !PortUtil.isFree(port) {
            port = PortUtil.firstFree(from: 47812) ?? 47812
        }
        setState(.starting)

        let proc = Process()
        proc.executableURL = paths.node
        // Lean V8: a small young generation keeps the engine's resident memory low (mail parsing
        // is bursty, not throughput-bound); the SQLite warning only clutters the log.
        proc.arguments = paths.nodeArgsPrefix + ["--max-semi-space-size=2", "--disable-warning=ExperimentalWarning", paths.engine.path]
        proc.currentDirectoryURL = paths.engine.deletingLastPathComponent()
        var env = ProcessInfo.processInfo.environment
        env["ZMAIL_PORT"] = String(port)
        env["ZMAIL_LOCALE"] = L10n.code
        env["ZMAIL_DATA_DIR"] = dataDir.path
        env["ZMAIL_UI_DIR"] = paths.uiDir.path
        env["ZMAIL_BRIDGE_URL"] = bridgeURL
        env["ZMAIL_BRIDGE_TOKEN"] = bridgeToken
        env["ZMAIL_PARENT_PID"] = String(getpid())
        env["NODE_ENV"] = env["NODE_ENV"] ?? "production"
        // The engine path override must not leak into a nested launch.
        env.removeValue(forKey: "ZMAIL_ENGINE_PATH")
        env.removeValue(forKey: "ZMAIL_NODE_PATH")
        proc.environment = env

        if let log = openLog() {
            proc.standardOutput = log
            proc.standardError = log
        }
        proc.terminationHandler = { [weak self] p in
            let code = p.terminationStatus
            let reason = p.terminationReason
            Task { @MainActor in self?.handleExit(code: code, reason: reason) }
        }
        do {
            try proc.run()
            // The child has its own descriptor now; drop ours.
            try? (proc.standardOutput as? FileHandle)?.close()
            process = proc
            lastLaunch = Date()
            appendLog("[zmail] engine started pid=\(proc.processIdentifier) port=\(port) node=\(paths.node.path)\n")
        } catch {
            setState(.failed("Impossible de lancer node : \(error.localizedDescription)"))
            scheduleRestart()
        }
    }

    private func handleExit(code: Int32, reason: Process.TerminationReason) {
        process = nil
        appendLog("[zmail] engine exited code=\(code) reason=\(reason == .uncaughtSignal ? "signal" : "exit")\n")
        guard !stopping else { return }
        // A run that lasted a minute resets the backoff.
        if Date().timeIntervalSince(lastLaunch) > 60 { restartCount = 0 }
        setState(.failed(L10n.tr("Le moteur s'est arrêté (code \(code)). Redémarrage…", "The engine stopped (code \(code)). Restarting…")))
        scheduleRestart()
    }

    private func scheduleRestart() {
        guard !stopping else { return }
        restartCount += 1
        let delay = min(30.0, pow(2.0, Double(min(restartCount, 6))) * 0.5) // 1s, 2s, 4s … 30s
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(delay))
            guard !self.stopping, self.process == nil else { return }
            self.launch()
            if await self.waitForHealth(timeout: 30) { self.setState(.running) }
        }
    }

    private func waitForHealth(timeout: TimeInterval) async -> Bool {
        let url = baseURL.appendingPathComponent("api/health")
        var deadline = Date().addingTimeInterval(timeout)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
        request.httpMethod = "GET"
        while Date() < deadline && !stopping {
            if let (_, response) = try? await URLSession.shared.data(for: request),
               (response as? HTTPURLResponse)?.statusCode == 200 {
                return true
            }
            if process == nil, case .failed = state { return false }
            // The engine waits for its key while Touch ID is on screen: that time does not count.
            if AppLock.shared.awaitingUser { deadline = Date().addingTimeInterval(timeout) }
            try? await Task.sleep(for: .milliseconds(250))
        }
        return false
    }

    private func setState(_ new: State) {
        state = new
        onStateChange?(new)
    }

    private func openLog() -> FileHandle? {
        let fm = FileManager.default
        // Simple rotation: keep one previous file once the log exceeds 10 MB.
        if let size = (try? fm.attributesOfItem(atPath: logURL.path)[.size]) as? Int, size > 10_000_000 {
            let old = logURL.appendingPathExtension("1")
            try? fm.removeItem(at: old)
            try? fm.moveItem(at: logURL, to: old)
        }
        return appendHandle()
    }

    /// O_APPEND so our own lines and the child's output never overwrite each other.
    private func appendHandle() -> FileHandle? {
        let fd = open(logURL.path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0o644)
        return fd >= 0 ? FileHandle(fileDescriptor: fd, closeOnDealloc: true) : nil
    }

    private func appendLog(_ line: String) {
        guard let handle = appendHandle() else { return }
        handle.write(Data(line.utf8))
    }
}
