import AppKit

/// One menu bar item for the whole Zippy suite (like Creative Cloud): every Zippy app installed
/// on the Mac, which ones are running, and — on hover — each running app's own panel.
///
/// Protocol (docs/zippy-bar.md), over DistributedNotificationCenter so any Zippy app can join:
/// - `com.zippy.bar.hello`  {bundleId}: an app starts; the current leader answers `leader`.
/// - `com.zippy.bar.leader` {bundleId}: "I draw the bar". Others keep no status item of their own.
/// - `com.zippy.bar.panel`  {bundleId, panel: JSON [{id, title, enabled, separator}]}: an app's panel.
/// - `com.zippy.bar.action` {bundleId, id}: the leader tells an app one of its items was chosen.
/// - `com.zippy.bar.resign` {bundleId}: the leader quits; another app takes over.
@MainActor
final class ZippyBar: NSObject, NSMenuDelegate {
    struct PanelItem: Codable { var id: String; var title: String; var enabled: Bool = true; var separator: Bool = false }
    private struct KnownApp { let name: String; let bundleIds: [String]; let tagline: String; let url: String }

    /// The suite, with where to learn about apps that are not installed yet.
    private static let suite: [KnownApp] = [
        KnownApp(name: "ZMail", bundleIds: ["com.zippy.zmail"], tagline: L10n.tr("Le Gmail gratuit et open source", "The free, open-source Gmail"), url: "https://github.com/AdamPomposelli"),
        KnownApp(name: "ZFlow", bundleIds: ["com.zippy.zflow"], tagline: L10n.tr("Le Wispr Flow gratuit et open source", "The free, open-source Wispr Flow"), url: "https://github.com/AdamPomposelli/ZFlow"),
        KnownApp(name: "ZNotes", bundleIds: ["com.zippy.znotes", "app.znotes"], tagline: L10n.tr("Le Notion gratuit et open source", "The free, open-source Notion"), url: "https://github.com/AdamPomposelli"),
        KnownApp(name: "ZPanel", bundleIds: ["com.zippy.zpanel"], tagline: L10n.tr("Le Vercel gratuit et open source", "The free, open-source Vercel"), url: "https://github.com/AdamPomposelli"),
        KnownApp(name: "ZPay", bundleIds: ["com.zippy.zpay"], tagline: L10n.tr("Le Stripe gratuit et open source", "The free, open-source Stripe"), url: "https://github.com/AdamPomposelli"),
        KnownApp(name: "ZCode", bundleIds: ["com.zippy.zcode"], tagline: L10n.tr("Le Claude Code gratuit et open source", "The free, open-source Claude Code"), url: "https://github.com/AdamPomposelli"),
    ]

    private enum Name {
        static let hello = Notification.Name("com.zippy.bar.hello")
        static let leader = Notification.Name("com.zippy.bar.leader")
        static let panel = Notification.Name("com.zippy.bar.panel")
        static let action = Notification.Name("com.zippy.bar.action")
        static let resign = Notification.Name("com.zippy.bar.resign")
    }

    private let center = DistributedNotificationCenter.default()
    private let me = Bundle.main.bundleIdentifier ?? "com.zippy.zmail"
    private var item: NSStatusItem?
    private var panels: [String: [PanelItem]] = [:]
    private var leader: String?
    private var ownPanel: () -> [PanelItem]
    private let onAction: (String) -> Void

    /// `ownPanel` is read each time the menu opens (fresh unread count…); `onAction` runs its items.
    init(ownPanel: @escaping () -> [PanelItem], onAction: @escaping (String) -> Void) {
        self.ownPanel = ownPanel
        self.onAction = onAction
        super.init()
    }

    func start() {
        let observe: (Notification.Name, @escaping @MainActor ([String: String]) -> Void) -> Void = { [center] name, handler in
            center.addObserver(forName: name, object: nil, queue: .main) { note in
                // Distributed notifications only carry plist strings here: a Sendable copy.
                let info = (note.userInfo ?? [:]).reduce(into: [String: String]()) { out, pair in
                    if let key = pair.key as? String, let value = pair.value as? String { out[key] = value }
                }
                MainActor.assumeIsolated { handler(info) }
            }
        }
        observe(Name.hello) { [weak self] info in
            guard let self, self.item != nil, info["bundleId"] != self.me else { return }
            self.post(Name.leader, [:])
        }
        observe(Name.leader) { [weak self] info in
            guard let self, let who = info["bundleId"], who != self.me else { return }
            self.leader = who
            self.removeItem()
            self.publishPanel()
        }
        observe(Name.panel) { [weak self] info in
            guard let self, let who = info["bundleId"], let json = info["panel"],
                  let items = try? JSONDecoder().decode([PanelItem].self, from: Data(json.utf8)) else { return }
            self.panels[who] = items
        }
        observe(Name.action) { [weak self] info in
            guard let self, info["target"] == self.me, let id = info["id"] else { return }
            self.onAction(id)
        }
        observe(Name.resign) { [weak self] info in
            guard let self, info["bundleId"] == self.leader else { return }
            self.leader = nil
            // Lowest-latency taker wins; the others hear its `leader` and stand down.
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int.random(in: 50...250))) { [weak self] in
                guard let self, self.leader == nil else { return }
                self.becomeLeader()
            }
        }
        post(Name.hello, [:])
        // No answer within 400 ms: nobody draws the bar yet, so this app does.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(400)) { [weak self] in
            guard let self, self.leader == nil else { return }
            self.becomeLeader()
        }
    }

    func stop() {
        if item != nil { post(Name.resign, [:]) }
        center.removeObserver(self)
    }

    /// Re-sends this app's panel to the leader (call when something it shows changes).
    func publishPanel() {
        guard leader != nil, let data = try? JSONEncoder().encode(ownPanel()), let json = String(data: data, encoding: .utf8) else { return }
        post(Name.panel, ["panel": json])
    }

    // MARK: Leader

    private func becomeLeader() {
        leader = nil
        guard item == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(systemSymbolName: "z.square", accessibilityDescription: "Suite Zippy")
        image?.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = "Suite Zippy"
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        self.item = item
        post(Name.leader, [:])
    }

    private func removeItem() {
        if let item { NSStatusBar.system.removeStatusItem(item) }
        item = nil
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuild(menu)
    }

    private func rebuild(_ menu: NSMenu) {
        menu.removeAllItems()
        let header = NSMenuItem(title: "Suite Zippy", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        let running = NSWorkspace.shared.runningApplications
        var missing: [KnownApp] = []
        for app in Self.suite {
            guard let url = app.bundleIds.lazy.compactMap({ NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }).first else {
                missing.append(app)
                continue
            }
            let bundleId = Bundle(url: url)?.bundleIdentifier ?? app.bundleIds[0]
            let isRunning = running.contains { $0.bundleIdentifier == bundleId }
            let row = NSMenuItem(title: app.name, action: nil, keyEquivalent: "")
            let icon = NSWorkspace.shared.icon(forFile: url.path)
            icon.size = NSSize(width: 18, height: 18)
            row.image = icon
            row.attributedTitle = Self.title(app.name, detail: isRunning ? "Ouvert" : nil)
            row.submenu = panelMenu(for: app, bundleId: bundleId, url: url, running: isRunning)
            menu.addItem(row)
        }

        if !missing.isEmpty {
            menu.addItem(.separator())
            let discover = NSMenuItem(title: L10n.tr("Découvrir", "Discover"), action: nil, keyEquivalent: "")
            discover.isEnabled = false
            menu.addItem(discover)
            for app in missing {
                let row = NSMenuItem(title: "\(app.name) — \(app.tagline)", action: #selector(openLink(_:)), keyEquivalent: "")
                row.target = self
                row.representedObject = app.url
                menu.addItem(row)
            }
        }
    }

    /// The hover panel: an app's own items when it published them (ZMail always does), else the basics.
    private func panelMenu(for app: KnownApp, bundleId: String, url: URL, running: Bool) -> NSMenu {
        let menu = NSMenu()
        let items = bundleId == me ? ownPanel() : running ? (panels[bundleId] ?? []) : []
        for entry in items {
            if entry.separator { menu.addItem(.separator()); continue }
            let row = NSMenuItem(title: entry.title, action: #selector(panelAction(_:)), keyEquivalent: "")
            row.target = self
            row.isEnabled = entry.enabled
            row.representedObject = [bundleId, entry.id]
            menu.addItem(row)
        }
        if items.isEmpty {
            let open = NSMenuItem(title: running ? L10n.tr("Afficher \(app.name)", "Show \(app.name)") : L10n.tr("Ouvrir \(app.name)", "Open \(app.name)"), action: #selector(launch(_:)), keyEquivalent: "")
            open.target = self
            open.representedObject = url
            menu.addItem(open)
            if running {
                let quit = NSMenuItem(title: L10n.tr("Quitter \(app.name)", "Quit \(app.name)"), action: #selector(quitApp(_:)), keyEquivalent: "")
                quit.target = self
                quit.representedObject = bundleId
                menu.addItem(quit)
            }
        }
        return menu
    }

    private static func title(_ name: String, detail: String?) -> NSAttributedString {
        let text = NSMutableAttributedString(string: name, attributes: [.font: NSFont.menuFont(ofSize: 0)])
        if let detail {
            text.append(NSAttributedString(string: "  ● \(detail)", attributes: [.font: NSFont.menuFont(ofSize: 11), .foregroundColor: NSColor.systemGreen]))
        }
        return text
    }

    @objc private func panelAction(_ sender: NSMenuItem) {
        guard let pair = sender.representedObject as? [String], pair.count == 2 else { return }
        if pair[0] == me { onAction(pair[1]) } else { post(Name.action, ["target": pair[0], "id": pair[1]]) }
    }

    @objc private func launch(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }

    @objc private func quitApp(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == id }?.terminate()
    }

    @objc private func openLink(_ sender: NSMenuItem) {
        guard let link = sender.representedObject as? String, let url = URL(string: link) else { return }
        NSWorkspace.shared.open(url)
    }

    private func post(_ name: Notification.Name, _ info: [String: String]) {
        var payload = info
        payload["bundleId"] = me
        center.postNotificationName(name, object: nil, userInfo: payload, deliverImmediately: true)
    }
}
