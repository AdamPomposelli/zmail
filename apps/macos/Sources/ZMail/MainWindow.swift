import AppKit
import WebKit

struct NativeContext: Sendable {
    var bridgeURL: String
    var bridgeToken: String
    var version: String
}

/// The single app window: native loading view, then the WKWebView hosting the UI.
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate {
    private let context: NativeContext
    private let loadingView = LoadingView(frame: .zero)
    private var webView: WKWebView?
    private var baseURL: URL?
    private var pendingPath: String?

    /// Fired for `{type:'setBadge'}` messages from the page.
    var onBadge: ((Int) -> Void)?

    init(context: NativeContext) {
        self.context = context
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.title = "ZMail"
        window.minSize = NSSize(width: 1000, height: 640)
        window.backgroundColor = Theme.background
        // The app's own light/dark choice (not just the system's), so the first frames match it.
        Appearance.apply(to: window)
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.tabbingMode = .disallowed
        window.center()
        window.setFrameAutosaveName("ZMailMainWindow")
        super.init(window: window)
        window.delegate = self

        let container = NSView()
        container.wantsLayer = true
        window.contentView = container
        pin(loadingView, in: container)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Voice input for the composer's assistant; events go to the page as `zmail:dictation`.
    private lazy var dictation: Dictation = {
        let dictation = Dictation()
        dictation.onEvent = { [weak self] event in
            var detail: [String: Any] = ["text": event.text, "final": event.final, "level": event.level]
            if let error = event.error { detail["error"] = error }
            guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('zmail:dictation', { detail: \(json) }))")
        }
        return dictation
    }()

    // MARK: Lock

    private var lockView: LockView?

    /// Covers the window while ZMail is locked (see AppLock).
    func setLock(_ state: AppLock.State) {
        guard let container = window?.contentView else { return }
        if state == .unlocked {
            guard let view = lockView else { return }
            lockView = nil
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.2
                view.animator().alphaValue = 0
            }, completionHandler: { [weak view] in
                MainActor.assumeIsolated { view?.removeFromSuperview() }
            })
            return
        }
        if lockView == nil {
            let view = LockView(frame: container.bounds)
            view.onUnlock = { Task { await AppLock.shared.unlock() } }
            pin(view, in: container)
            lockView = view
        }
        // Always on top, above the web view and the boot screen.
        if let lockView { container.addSubview(lockView, positioned: .above, relativeTo: nil) }
        lockView?.show(unlocking: state == .unlocking)
    }

    /// True once the web UI (not the boot page) has been requested.
    private(set) var isAppLoaded = false

    func showError(_ message: String?) {
        loadingView.showError(message)
        bootStep(error: message)
    }

    // MARK: Boot screen

    private var bootDir: URL?

    /// Shows the skeleton boot page (ui/boot.html) at once, while the engine starts.
    func showBoot(uiDir: URL) {
        let page = uiDir.appendingPathComponent("boot.html")
        guard webView == nil, FileManager.default.fileExists(atPath: page.path) else { return }
        bootDir = uiDir
        let webView = makeWebView()
        self.webView = webView
        guard let container = window?.contentView else { return }
        container.addSubview(webView, positioned: .above, relativeTo: loadingView)
        pin(webView, in: container, add: false)
        webView.loadFileURL(page, allowingReadAccessTo: uiDir)
    }

    /// Moves the boot page's progress bar to a real milestone (`cap` bounds the creep until the next one).
    func bootStep(progress: Int, label: String, cap: Int) {
        let text = label.replacingOccurrences(of: "'", with: "\\'")
        webView?.evaluateJavaScript("window.zmailBoot && window.zmailBoot.set(\(progress), '\(text)', \(cap))")
    }

    private func bootStep(error: String?) {
        guard let error else { webView?.evaluateJavaScript("window.zmailBoot && window.zmailBoot.error(null)"); return }
        let data = (try? JSONSerialization.data(withJSONObject: [error])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        webView?.evaluateJavaScript("window.zmailBoot && window.zmailBoot.error(\(data)[0])")
    }

    /// Creates the web view and loads the inbox once the engine is healthy.
    func loadApp(baseURL: URL) {
        self.baseURL = baseURL
        isAppLoaded = true
        if let webView {
            webView.load(URLRequest(url: url(for: pendingPath ?? "/mail/inbox")))
            pendingPath = nil
            return
        }
        let webView = makeWebView()
        self.webView = webView
        guard let container = window?.contentView else { return }
        container.addSubview(webView, positioned: .below, relativeTo: loadingView)
        pin(webView, in: container, add: false)
        webView.load(URLRequest(url: url(for: pendingPath ?? "/mail/inbox")))
        pendingPath = nil
    }

    func navigate(to path: String) {
        guard let webView, baseURL != nil else { pendingPath = path; return }
        // The app is already loaded: route inside it (instant, keeps state) instead of reloading the page.
        if let current = webView.url, isAppURL(current) {
            let data = (try? JSONSerialization.data(withJSONObject: [path])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"/\"]"
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('zmail:navigate', { detail: \(data)[0] }))")
            return
        }
        webView.load(URLRequest(url: url(for: path)))
    }

    func reload() { webView?.reload() }

    /// Fires a window event in the web UI (menu bar actions: compose, chat…).
    func send(event name: String) {
        let safe = name.filter { $0.isLetter || $0 == ":" || $0 == "-" }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(safe)'))")
    }

    func present() {
        cancelHibernation()
        if hibernated { wake() }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
        if AppLock.shared.state == .locked, AppLock.shared.active { Task { await AppLock.shared.unlock() } }
    }

    // MARK: Hibernation

    /// Out of sight for this long, the web view is released: its WebKit processes (the biggest
    /// memory cost of the app) exit. The engine keeps syncing and notifying; reopening is instant.
    static let hibernateAfter: TimeInterval = 10 * 60
    private var hibernateTimer: Timer?
    private(set) var hibernated = false
    private var resumePath: String?

    func scheduleHibernation() {
        cancelHibernation()
        hibernateTimer = Timer.scheduledTimer(withTimeInterval: Self.hibernateAfter, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.hibernate() }
        }
    }

    private func cancelHibernation() {
        hibernateTimer?.invalidate()
        hibernateTimer = nil
    }

    private func hibernate() {
        guard !hibernated, isAppLoaded, let webView, window?.isVisible != true || window?.isMiniaturized == true else { return }
        if let url = webView.url, isAppURL(url) {
            resumePath = url.path + (url.query.map { "?\($0)" } ?? "")
        }
        webView.stopLoading()
        webView.removeFromSuperview()
        self.webView = nil
        hibernated = true
        // Out of sight that long: Touch ID again before the mail shows.
        AppLock.shared.lock()
        NSLog("[zmail] web view released after \(Int(Self.hibernateAfter / 60)) min out of sight")
    }

    private func wake() {
        hibernated = false
        isAppLoaded = false
        if let bootDir { showBoot(uiDir: bootDir) }
        bootStep(progress: 82, label: L10n.tr("Réveil de ZMail", "Waking ZMail up"), cap: 92)
        guard let baseURL else { return }
        pendingPath = resumePath
        resumePath = nil
        loadApp(baseURL: baseURL)
    }

    // MARK: - Private

    private func url(for path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL!
    }

    private func pin(_ view: NSView, in container: NSView, add: Bool = true) {
        view.translatesAutoresizingMaskIntoConstraints = false
        if add { container.addSubview(view) }
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            view.topAnchor.constraint(equalTo: container.topAnchor),
            view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }

    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: injectedScript(), injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: Appearance.bootScript(), injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        controller.add(WeakScriptHandler(self), name: "zmail")
        config.userContentController = controller

        let webView = DragWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false
        webView.underPageBackgroundColor = Theme.background
        webView.setValue(false, forKey: "drawsBackground") // avoid a white flash before first paint
        webView.customUserAgent = nil
        #if DEBUG
        webView.isInspectable = true
        #else
        webView.isInspectable = UserDefaults.standard.bool(forKey: "ZMailWebInspector")
        #endif
        return webView
    }

    private func injectedScript() -> String {
        let payload: [String: Any] = [
            "platform": "macos",
            "bridgeUrl": context.bridgeURL,
            "bridgeToken": context.bridgeToken,
            "version": context.version,
        ]
        let json = (try? JSONSerialization.data(withJSONObject: payload)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        (function () {
          document.documentElement.style.setProperty('--window-radius', '\(Int(windowCornerRadius().rounded()))px');
          var native = \(json);
          native.postMessage = function (msg) { window.webkit.messageHandlers.zmail.postMessage(msg); };
          Object.defineProperty(window, 'zmailNative', { value: Object.freeze(native), writable: false, configurable: false });
        })();
        """
    }

    fileprivate func handleScriptMessage(_ body: Any) {
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "dictation":
            if msg["action"] as? String == "stop" { dictation.stop() } else { dictation.start(language: msg["language"] as? String) }
        case "setAppearance":
            Appearance.save(mode: msg["mode"] as? String ?? "system", css: msg["css"] as? String ?? "")
            Appearance.apply(to: window)
        case "setBadge":
            let count = (msg["count"] as? NSNumber)?.intValue ?? 0
            onBadge?(count)
        case "copy":
            if let text = msg["text"] as? String { Pasteboard.copy(text) }
        case "startDrag":
            // WKWebView has no CSS drag regions: the page asks, and the pending mouse-down drags the window.
            (webView as? DragWebView)?.dragWindowFromLastMouseDown()
        case "setLocale":
            if let locale = msg["locale"] as? String { L10n.save(locale) }
        case "zoomWindow":
            webView?.window?.zoom(nil)
        case "openExternal":
            if let s = msg["url"] as? String, let url = URL(string: s), Self.isExternalScheme(url) {
                NSWorkspace.shared.open(url)
            }
        default:
            break
        }
    }

    private func isAppURL(_ url: URL) -> Bool {
        guard let baseURL else { return false }
        return url.scheme == baseURL.scheme && url.host == baseURL.host && url.port == baseURL.port
    }

    private static func isExternalScheme(_ url: URL) -> Bool {
        ["http", "https", "mailto", "tel", "facetime", "x-apple.systempreferences"].contains(url.scheme?.lowercased() ?? "")
    }

    // MARK: Window corners

    /// The window's real corner radius, so the web panels can be drawn concentric with it.
    /// AppKit only exposes it privately on the theme frame; fall back to the system default.
    private func windowCornerRadius() -> CGFloat {
        let selector = NSSelectorFromString("_cornerRadius")
        if let frame = window?.contentView?.superview, frame.responds(to: selector),
           let implementation = frame.method(for: selector) {
            typealias Getter = @convention(c) (AnyObject, Selector) -> CGFloat
            let radius = unsafeBitCast(implementation, to: Getter.self)(frame, selector)
            if radius > 0 && radius < 64 { return radius }
        }
        if #available(macOS 26, *) { return 16 }
        return 10
    }

    private func applyWindowRadius(_ radius: CGFloat) {
        webView?.evaluateJavaScript("document.documentElement.style.setProperty('--window-radius', '\(Int(radius.rounded()))px')")
    }

    // Square corners in full screen, the window's own curve otherwise.
    func windowDidEnterFullScreen(_ notification: Notification) { applyWindowRadius(0) }
    func windowDidExitFullScreen(_ notification: Notification) { applyWindowRadius(windowCornerRadius()) }

    // MARK: NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil) // the app stays in the Dock; a click reopens it
        scheduleHibernation()
        return false
    }

    func windowDidMiniaturize(_ notification: Notification) { scheduleHibernation() }
    func windowDidDeminiaturize(_ notification: Notification) { present() }
}

// MARK: - Navigation, UI and downloads

extension MainWindowController: WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        if navigationAction.shouldPerformDownload { return (.download, preferences) }
        guard let url = navigationAction.request.url else { return (.cancel, preferences) }
        let scheme = url.scheme?.lowercased() ?? ""
        if ["about", "blob", "data"].contains(scheme) || isAppURL(url) { return (.allow, preferences) }
        // The local boot page, and only it.
        if scheme == "file", let bootDir, url.standardizedFileURL.path.hasPrefix(bootDir.standardizedFileURL.path) { return (.allow, preferences) }
        // Subframes (e.g. sandboxed email bodies) may load remote content in place.
        if navigationAction.targetFrame?.isMainFrame == false && !navigationAction.navigationType.isUserInitiated {
            return (.allow, preferences)
        }
        if Self.isExternalScheme(url) { NSWorkspace.shared.open(url) }
        return (.cancel, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if !navigationResponse.canShowMIMEType { return .download }
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.lowercased().hasPrefix("attachment") {
            return .download
        }
        return .allow
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !loadingView.isHidden else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.2
            loadingView.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated { self?.loadingView.isHidden = true }
        })
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // target=_blank / window.open → default browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isAppURL(url) { webView.load(URLRequest(url: url)) }
            else if Self.isExternalScheme(url) { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo) async -> [URL]? {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        guard let window else { return panel.runModal() == .OK ? panel.urls : nil }
        let response = await panel.beginSheetModal(for: window)
        return response == .OK ? panel.urls : nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: L10n.tr("Annuler", "Undo"))
        return alert.runModal() == .alertFirstButtonReturn
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String) async -> URL? {
        let fm = FileManager.default
        let downloads = fm.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
        let name = (suggestedFilename as NSString).lastPathComponent
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var candidate = downloads.appendingPathComponent(name.isEmpty ? "download" : name)
        var n = 1
        while fm.fileExists(atPath: candidate.path) {
            let numbered = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
            candidate = downloads.appendingPathComponent(numbered)
            n += 1
        }
        return candidate
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        NSLog("[zmail] download failed: \(error.localizedDescription)")
    }
}

private extension WKNavigationType {
    var isUserInitiated: Bool { self == .linkActivated || self == .formSubmitted }
}

/// Remembers the last mouse-down so a page-initiated drag can move the window.
final class DragWebView: WKWebView {
    private var lastMouseDown: NSEvent?

    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }

    func dragWindowFromLastMouseDown() {
        guard let event = lastMouseDown, NSEvent.pressedMouseButtons & 1 == 1,
              ProcessInfo.processInfo.systemUptime - event.timestamp < 0.5 else { return }
        window?.performDrag(with: event)
    }
}

/// Breaks the WKUserContentController → handler retain cycle.
@MainActor
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: MainWindowController?
    init(_ target: MainWindowController) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handleScriptMessage(message.body)
    }
}


/// The UI's mode (light/dark/system) and colour theme, remembered for the next launch: the boot
/// page and the window background are painted with them before the web app is loaded.
enum Appearance {
    private static let modeKey = "ZMailAppearance"
    private static let cssKey = "ZMailThemeCSS"

    static var mode: String { UserDefaults.standard.string(forKey: modeKey) ?? "system" }

    static func save(mode: String, css: String) {
        UserDefaults.standard.set(["light", "dark"].contains(mode) ? mode : "system", forKey: modeKey)
        UserDefaults.standard.set(String(css.prefix(64_000)), forKey: cssKey)
    }

    @MainActor static func apply(to window: NSWindow?) {
        window?.appearance = switch mode {
        case "dark": NSAppearance(named: .darkAqua)
        case "light": NSAppearance(named: .aqua)
        default: nil
        }
    }

    /// Runs at document start in every page; only the local boot page (file://) uses it: the
    /// app pages restore the same state themselves from their own storage.
    static func bootScript() -> String {
        let payload = (try? JSONSerialization.data(withJSONObject: [mode, UserDefaults.standard.string(forKey: cssKey) ?? ""]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[\"system\",\"\"]"
        return """
        (function () {
          if (location.protocol !== 'file:') return;
          var p = \(payload), mode = p[0], css = p[1], root = document.documentElement;
          var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
          root.classList.toggle('dark', dark);
          root.style.colorScheme = dark ? 'dark' : 'light';
          if (css) { var s = document.createElement('style'); s.id = 'zmail-theme'; s.textContent = css; root.appendChild(s); }
        })();
        """
    }
}
