import AppKit
import Security

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let notifications = NotificationManager()
    private let ai = AIService()
    private var bridge: BridgeServer?
    private var engine: EngineProcess?
    private var windowController: MainWindowController?
    private var zippyBar: ZippyBar?
    private var signalSources: [DispatchSourceSignal] = []

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0-dev"
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MenuBuilder.build(target: self)
        installSignalHandlers()
        notifications.setUp()
        notifications.onOpen = { [weak self] threadId in self?.openThread(threadId) }
        startZippyBar()
        NotificationCenter.default.addObserver(forName: L10n.didChange, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                NSApp.mainMenu = MenuBuilder.build(target: self)
                self.notifications.setUp()
            }
        }

        let dataDir = Self.prepareDataDirectory()
        let token = Self.randomToken()
        AppLock.shared.dataDir = dataDir
        AppLock.shared.onStateChange = { [weak self] state in self?.windowController?.setLock(state) }
        AppLock.shared.onEnabledChange = { [weak self] in
            guard let self else { return }
            NSApp.mainMenu = MenuBuilder.build(target: self)
        }

        Task { await boot(dataDir: dataDir, token: token) }
    }

    private func boot(dataDir: URL, token: String) async {
        let api = BridgeAPI(token: token, ai: ai, notifications: notifications)
        let server = BridgeServer { req in await api.handle(req) }
        bridge = server

        let bridgePort: UInt16
        do {
            bridgePort = try await server.start(preferredPort: 47811)
        } catch {
            NSLog("[zmail] bridge failed to start: \(error)")
            showWindow(context: NativeContext(bridgeURL: "", bridgeToken: "", version: Self.version))
            windowController?.showError(L10n.tr("Impossible de démarrer le pont natif : \(error.localizedDescription)", "Could not start the native bridge: \(error.localizedDescription)"))
            return
        }
        let bridgeURL = "http://127.0.0.1:\(bridgePort)"
        NSLog("[zmail] bridge listening on \(bridgeURL)")

        showWindow(context: NativeContext(bridgeURL: bridgeURL, bridgeToken: token, version: Self.version))
        windowController?.showBoot(uiDir: EnginePaths.resolve().uiDir)
        windowController?.bootStep(progress: 14, label: L10n.tr("Démarrage du moteur sécurisé", "Starting the secure engine"), cap: 30)

        let engine = EngineProcess(dataDir: dataDir, bridgeURL: bridgeURL, bridgeToken: token)
        self.engine = engine
        var wasRunning = false
        var firstStartDone = false
        engine.onStateChange = { [weak self, weak engine] state in
            guard let self, let engine, let wc = self.windowController else { return }
            switch state {
            case .failed(let message):
                wc.showError(message)
            case .running:
                wc.showError(nil)
                // After a crash-restart the engine may have moved ports: reload from the new base URL.
                // Also when the very first start failed and a retry succeeded: the window still shows
                // the boot screen and would otherwise wait forever.
                if wasRunning || (firstStartDone && !wc.isAppLoaded) { wc.loadApp(baseURL: engine.baseURL) }
                wasRunning = true
            default:
                break
            }
        }
        // While node boots: the engine unlocks the Keychain key, opens the database, then the mailboxes.
        let staged = Task { @MainActor [weak self] in
            for (delay, progress, label, cap) in [(0.5, 32, L10n.tr("Déverrouillage de vos clés dans le Trousseau", "Unlocking your keys in the Keychain"), 46),
                                                  (1.3, 48, "Ouverture de votre base de mails", 60),
                                                  (2.4, 62, L10n.tr("Connexion à vos boîtes mail", "Connecting to your mailboxes"), 76)] {
                try? await Task.sleep(for: .seconds(delay))
                if Task.isCancelled { return }
                self?.windowController?.bootStep(progress: progress, label: label, cap: cap)
            }
        }
        let started = await engine.start()
        firstStartDone = true
        staged.cancel()
        if started {
            windowController?.bootStep(progress: 80, label: L10n.tr("Ouverture de votre boîte de réception", "Opening your inbox"), cap: 86)
            try? await Task.sleep(for: .milliseconds(240))
            windowController?.loadApp(baseURL: engine.baseURL)
        }
    }

    private func showWindow(context: NativeContext) {
        let wc = MainWindowController(context: context)
        wc.onBadge = { DockBadge.set($0) }
        windowController = wc
        // Locked from the first frame: Touch ID before any mail shows (present() asks for it).
        if AppLock.shared.active { wc.setLock(AppLock.shared.state) }
        wc.present()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        windowController?.present()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    // Hidden with ⌘H: same as a closed window, the UI hibernates after a while.
    func applicationDidHide(_ notification: Notification) { windowController?.scheduleHibernation() }
    func applicationDidUnhide(_ notification: Notification) { windowController?.present() }

    func applicationWillTerminate(_ notification: Notification) {
        zippyBar?.stop()
        engine?.stop()
        bridge?.stop()
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: Actions

    /// ZMail's panel in the suite-wide Zippy menu bar item.
    private func startZippyBar() {
        let bar = ZippyBar(
            ownPanel: {
                let unread = DockBadge.current
                return [
                    .init(id: "open", title: unread > 0
                        ? L10n.tr("Ouvrir ZMail — \(unread > 99 ? "99+" : String(unread)) non lu\(unread > 1 ? "s" : "")", "Open ZMail — \(unread > 99 ? "99+" : String(unread)) unread")
                        : L10n.tr("Ouvrir ZMail", "Open ZMail")),
                    .init(id: "compose", title: L10n.tr("Nouveau message", "New message")),
                    .init(id: "chat", title: L10n.tr("Chat IA", "AI chat")),
                    .init(id: "sep", title: "", separator: true),
                    .init(id: "settings", title: L10n.tr("Réglages…", "Settings…")),
                    .init(id: "quit", title: L10n.tr("Quitter ZMail", "Quit ZMail")),
                ]
            },
            onAction: { [weak self] id in
                guard let self else { return }
                switch id {
                case "quit": NSApp.terminate(nil)
                case "settings": self.windowController?.present(); self.windowController?.navigate(to: "/settings/accounts")
                case "compose": self.windowController?.present(); self.windowController?.send(event: "zmail:compose")
                case "chat": self.windowController?.present(); self.windowController?.send(event: "zmail:open-agent")
                default: self.windowController?.present()
                }
            })
        bar.start()
        zippyBar = bar
    }

    private func openThread(_ threadId: String?) {
        windowController?.present()
        var path = "/mail/inbox"
        // The cleaning agent's questions open the AI chat on its run, not a conversation.
        if let threadId, threadId.hasPrefix("agent:"),
           let encoded = String(threadId.dropFirst(6)).addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) {
            path += "?agent=\(encoded)"
        } else if let threadId, !threadId.isEmpty,
           let encoded = threadId.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) {
            path += "?thread=\(encoded)"
        }
        windowController?.navigate(to: path)
    }

    @objc func lockNow(_ sender: Any?) {
        AppLock.shared.lock()
    }

    @objc func openSettings(_ sender: Any?) {
        windowController?.present()
        windowController?.navigate(to: "/settings/general")
    }

    @objc func reloadPage(_ sender: Any?) {
        windowController?.reload()
    }

    @objc func showMainWindow(_ sender: Any?) {
        windowController?.present()
    }

    // MARK: Setup helpers

    /// SIGTERM/SIGINT (e.g. `kill`, Ctrl-C under `swift run`) go through a normal
    /// terminate so the engine child is stopped instead of orphaned.
    private func installSignalHandlers() {
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { MainActor.assumeIsolated { NSApp.terminate(nil) } }
            source.resume()
            signalSources.append(source)
        }
    }

    private static func prepareDataDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        // ZMAIL_DATA_DIR lets demos and tests run against a separate mailbox store.
        let dir = ProcessInfo.processInfo.environment["ZMAIL_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? base.appendingPathComponent("ZMail", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        return dir
    }

    private static func randomToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            return UUID().uuidString + UUID().uuidString
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}

extension CharacterSet {
    static let urlQueryValueAllowed: CharacterSet = {
        var set = CharacterSet.urlQueryAllowed
        set.remove(charactersIn: "&=+?#")
        return set
    }()
}

/// Programmatic main menu (no nib). Edit items route through the responder chain
/// so copy/paste/undo work inside WKWebView.
@MainActor
enum MenuBuilder {
    static func build(target: AppDelegate) -> NSMenu {
        let main = NSMenu()

        let appMenu = NSMenu(title: "ZMail")
        appMenu.addItem(withTitle: L10n.tr("À propos de ZMail", "About ZMail"),
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settings = appMenu.addItem(withTitle: L10n.tr("Réglages…", "Settings…"), action: #selector(AppDelegate.openSettings(_:)), keyEquivalent: ",")
        settings.target = target
        appMenu.addItem(.separator())
        // The lock itself is turned on in Settings → Security; once on, it can be locked from here.
        if AppLock.shared.active {
            let lockNow = appMenu.addItem(withTitle: L10n.tr("Verrouiller ZMail", "Lock ZMail"), action: #selector(AppDelegate.lockNow(_:)), keyEquivalent: "l")
            lockNow.keyEquivalentModifierMask = [.command, .shift]
            lockNow.target = target
            appMenu.addItem(.separator())
        }
        let services = NSMenu(title: "Services")
        appMenu.addItem(withTitle: "Services", action: nil, keyEquivalent: "").submenu = services
        NSApp.servicesMenu = services
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tr("Masquer ZMail", "Hide ZMail"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: L10n.tr("Masquer les autres", "Hide Others"),
                                         action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: L10n.tr("Tout afficher", "Show All"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tr("Quitter ZMail", "Quit ZMail"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(withTitle: "ZMail", action: nil, keyEquivalent: "").submenu = appMenu

        let edit = NSMenu(title: L10n.tr("Édition", "Edit"))
        edit.addItem(withTitle: L10n.tr("Annuler", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: L10n.tr("Rétablir", "Redo"), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: L10n.tr("Couper", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: L10n.tr("Copier", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: L10n.tr("Coller", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        let pastePlain = edit.addItem(withTitle: L10n.tr("Coller et adapter le style", "Paste and Match Style"),
                                      action: #selector(NSTextView.pasteAsPlainText(_:)), keyEquivalent: "v")
        pastePlain.keyEquivalentModifierMask = [.command, .option, .shift]
        edit.addItem(withTitle: L10n.tr("Supprimer", "Delete"), action: #selector(NSText.delete(_:)), keyEquivalent: "")
        edit.addItem(withTitle: L10n.tr("Tout sélectionner", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(withTitle: L10n.tr("Édition", "Edit"), action: nil, keyEquivalent: "").submenu = edit

        let view = NSMenu(title: L10n.tr("Présentation", "View"))
        let reload = view.addItem(withTitle: L10n.tr("Recharger", "Reload"), action: #selector(AppDelegate.reloadPage(_:)), keyEquivalent: "r")
        reload.target = target
        view.addItem(.separator())
        let fullScreen = view.addItem(withTitle: L10n.tr("Activer le mode plein écran", "Enter Full Screen"),
                                      action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        main.addItem(withTitle: L10n.tr("Présentation", "View"), action: nil, keyEquivalent: "").submenu = view

        let window = NSMenu(title: L10n.tr("Fenêtre", "Window"))
        window.addItem(withTitle: L10n.tr("Fermer", "Close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        window.addItem(withTitle: L10n.tr("Placer dans le Dock", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: L10n.tr("Réduire/agrandir", "Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        window.addItem(.separator())
        let show = window.addItem(withTitle: "ZMail", action: #selector(AppDelegate.showMainWindow(_:)), keyEquivalent: "0")
        show.target = target
        window.addItem(withTitle: L10n.tr("Tout ramener au premier plan", "Bring All to Front"),
                       action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        main.addItem(withTitle: L10n.tr("Fenêtre", "Window"), action: nil, keyEquivalent: "").submenu = window
        NSApp.windowsMenu = window

        return main
    }
}
