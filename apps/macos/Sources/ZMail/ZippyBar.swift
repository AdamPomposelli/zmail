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
        item.button?.image = ZippyGlyph.menuBarImage()
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


/// The suite's mark in the menu bar: the Zippy tile with its Z cut out, drawn from the brand kit's
/// glyph (Zippy/brand-kit/apps/zippy/zippy-glyph-ink.svg, the same Z as in every app icon). A
/// template image, so macOS draws it black or white with the menu bar, like its own icons.
enum ZippyGlyph {
    /// The glyph's outline, in its SVG units (origin top-left), one polygon.
    private static let size = CGSize(width: 633.2, height: 579.5)
    private static let outline: [CGFloat] = [
        24.4, 107.4, 22.3, 111.7, 20.1, 117.4, 18.7, 123.0, 18.1, 128.5, 18.1, 134.0, 18.7, 139.1, 19.7, 144.0, 21.8, 149.6, 24.3, 154.6, 27.7, 159.8,
        30.7, 163.3, 34.0, 166.3, 37.8, 169.0, 43.0, 171.9, 49.2, 174.5, 55.0, 176.4, 57.9, 176.8, 68.6, 177.1, 106.1, 177.6, 322.0, 178.6, 146.4,
        328.7, 67.2, 397.3, 48.2, 414.3, 33.9, 428.0, 22.9, 439.6, 18.6, 444.6, 15.1, 449.2, 11.5, 455.0, 6.5, 465.0, 3.6, 472.1, 1.6, 479.3, 0.4,
        487.4, 0.0, 497.2, 0.4, 504.8, 1.8, 513.8, 3.6, 521.5, 6.2, 529.4, 8.7, 535.0, 11.7, 539.9, 17.9, 548.0, 25.1, 555.9, 31.4, 561.7, 35.1,
        564.7, 38.9, 567.2, 43.9, 570.1, 50.4, 573.1, 57.4, 575.5, 64.8, 577.3, 72.5, 577.8, 95.9, 578.5, 133.6, 579.1, 205.8, 579.5, 374.2, 579.5,
        431.0, 579.1, 473.6, 578.6, 502.2, 577.8, 516.7, 576.8, 527.7, 573.8, 532.0, 572.3, 537.1, 570.1, 540.6, 568.3, 543.4, 566.4, 551.4, 560.2,
        559.5, 553.4, 573.0, 541.3, 596.5, 519.3, 603.0, 512.8, 611.1, 504.3, 617.2, 497.1, 621.2, 491.4, 624.1, 485.4, 626.1, 479.2, 627.4, 472.5,
        628.0, 465.4, 627.9, 458.0, 627.0, 450.9, 625.4, 444.2, 623.1, 437.9, 620.1, 432.0, 616.3, 425.7, 612.3, 420.5, 608.3, 416.5, 603.2, 412.4,
        596.9, 408.4, 590.2, 405.1, 583.2, 402.6, 579.0, 401.5, 570.1, 400.8, 552.7, 400.2, 526.9, 399.8, 464.8, 399.2, 312.0, 398.6, 474.0, 250.4,
        539.0, 190.4, 564.6, 166.2, 594.6, 137.2, 609.0, 122.8, 614.4, 117.0, 622.0, 108.4, 624.0, 105.5, 627.5, 98.1, 630.1, 90.7, 631.9, 83.3,
        632.9, 76.0, 633.2, 68.8, 632.7, 61.7, 631.6, 54.8, 629.8, 47.9, 627.3, 41.3, 624.2, 35.1, 620.5, 29.2, 616.1, 23.8, 610.2, 17.7, 605.7, 13.6,
        600.2, 9.7, 595.9, 7.3, 590.4, 4.9, 584.8, 2.9, 578.9, 1.5, 566.2, 0.8, 539.6, 0.4, 424.1, 0.0, 327.5, 0.2, 264.1, 0.6, 188.9, 1.8, 161.9,
        2.7, 156.0, 3.1, 148.7, 3.9, 143.3, 5.7, 138.1, 7.8, 133.2, 10.2, 128.6, 12.8, 122.4, 17.1, 108.4, 28.4, 71.7, 60.0, 48.4, 81.2, 41.2, 88.2,
        32.6, 97.0, 28.4, 101.8
    ]

    static func zPath(in rect: CGRect) -> NSBezierPath {
        let scale = min(rect.width / size.width, rect.height / size.height)
        let x = rect.minX + (rect.width - size.width * scale) / 2
        let y = rect.minY + (rect.height - size.height * scale) / 2
        let path = NSBezierPath()
        for i in stride(from: 0, to: outline.count, by: 2) {
            let point = NSPoint(x: x + outline[i] * scale, y: y + (size.height - outline[i + 1]) * scale)
            if i == 0 { path.move(to: point) } else { path.line(to: point) }
        }
        path.close()
        return path
    }

    /// 18 × 18 pt: a 16 pt tile with the brand's corner radius (22.5 %), the Z knocked out of it.
    static func menuBarImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
            let tile = rect.insetBy(dx: 1, dy: 1)
            let shape = NSBezierPath(roundedRect: tile, xRadius: tile.width * 0.225, yRadius: tile.width * 0.225)
            shape.append(zPath(in: tile.insetBy(dx: tile.width * 0.2, dy: tile.width * 0.22)))
            shape.windingRule = .evenOdd
            NSColor.black.setFill()
            shape.fill()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Suite Zippy"
        return image
    }
}
