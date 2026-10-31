import AppKit

/// A one-time code, shown the moment its mail arrives: a floating card in the top-right corner,
/// above every app and on every Space (even in full screen), with one button that copies it.
/// It is ZMail's own window, so it shows even when macOS notifications are turned off, and the
/// copy button is right there (a notification hides its actions behind « Options »).
@MainActor
final class CodeCard: NSObject {
    static let shared = CodeCard()

    /// Opens the mail the code came from.
    var onOpen: ((String?) -> Void)?

    private var panel: NSPanel?
    private var dismissTimer: Timer?
    private var hovering = false
    private static let margin: CGFloat = 14
    /// How long the card stays, shown by the bar at its bottom; the pointer on it stops the clock.
    static let lifetime: TimeInterval = 7

    func show(code: String, title: String, subtitle: String?, threadId: String?) {
        close(animated: false)
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 100),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false)
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        let card = CardView(
            code: code,
            source: subtitle ?? title,
            onCopy: { [weak self] in self?.copy(code) },
            onOpen: { [weak self] in
                self?.close(animated: true)
                self?.onOpen?(threadId)
            },
            onClose: { [weak self] in self?.close(animated: true) },
            onHover: { [weak self] inside in self?.hover(inside) })
        panel.contentView = card
        self.panel = panel

        // Slides in from the right, under the menu bar of the screen in use.
        let screen = NSScreen.main ?? NSScreen.screens.first
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        card.layoutSubtreeIfNeeded()
        let size = card.fittingSize
        let target = NSRect(x: visible.maxX - size.width - Self.margin, y: visible.maxY - size.height - Self.margin, width: size.width, height: size.height)
        panel.setFrame(target.offsetBy(dx: 40, dy: 0), display: false)
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.28
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.3, 1.1)
            panel.animator().setFrame(target, display: true)
            panel.animator().alphaValue = 1
        }
        // Silent on purpose: the card shows the code, no chime for each one.
        startCountdown()
    }

    private func copy(_ code: String) {
        Pasteboard.copy(code)
        (panel?.contentView as? CardView)?.showCopied()
        dismissTimer?.invalidate()
        dismissTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.close(animated: true) }
        }
    }

    private func hover(_ inside: Bool) {
        hovering = inside
        // The clock stops while the pointer is on it, and starts over when it leaves.
        if inside {
            dismissTimer?.invalidate()
            (panel?.contentView as? CardView)?.resetCountdown()
        } else {
            startCountdown()
        }
    }

    private func startCountdown() {
        dismissTimer?.invalidate()
        (panel?.contentView as? CardView)?.runCountdown(Self.lifetime)
        dismissTimer = Timer.scheduledTimer(withTimeInterval: Self.lifetime, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.hovering else { return }
                self.close(animated: true)
            }
        }
    }

    func close(animated: Bool) {
        dismissTimer?.invalidate()
        guard let panel else { return }
        self.panel = nil
        hovering = false
        guard animated else { panel.orderOut(nil); return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.2
            panel.animator().alphaValue = 0
            panel.animator().setFrame(panel.frame.offsetBy(dx: 30, dy: 0), display: true)
        }, completionHandler: { panel.orderOut(nil) })
    }
}

/// The card: app icon and where the code comes from, the code in large digits, « Ouvrir le mail »
/// and « Copier », and a thin bar along the bottom that runs out with the time left.
final class CardView: NSVisualEffectView {
    private let copyButton: PillButton
    private let countdown = CALayer()
    private let onCopy: () -> Void
    private let onOpen: () -> Void
    private let onClose: () -> Void
    private let onHover: (Bool) -> Void
    private static let padding: CGFloat = 16

    init(code: String, source: String, onCopy: @escaping () -> Void, onOpen: @escaping () -> Void, onClose: @escaping () -> Void, onHover: @escaping (Bool) -> Void) {
        self.onCopy = onCopy
        self.onOpen = onOpen
        self.onClose = onClose
        self.onHover = onHover
        copyButton = PillButton(title: L10n.tr("Copier", "Copy"), symbol: "doc.on.doc", primary: true)
        super.init(frame: .zero)
        material = .popover
        blendingMode = .behindWindow
        state = .active
        wantsLayer = true
        layer?.cornerRadius = 16
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.borderWidth = 0.5
        layer?.borderColor = NSColor.separatorColor.cgColor

        // Header: « [ZMail] Code à usage unique · Slash          × »
        let icon = NSImageView(image: NSApp.applicationIconImage ?? NSImage())
        icon.imageScaling = .scaleProportionallyUpOrDown
        let label = NSTextField(labelWithString: "\(L10n.tr("Code à usage unique", "One-time password")) · \(source)")
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = .secondaryLabelColor
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let close = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: L10n.tr("Fermer", "Close"))!, target: nil, action: nil)
        close.isBordered = false
        close.contentTintColor = .tertiaryLabelColor
        close.symbolConfiguration = .init(pointSize: 10, weight: .semibold)

        // The code never shrinks: the card grows to fit it.
        let digits = NSTextField(labelWithString: Self.spaced(code))
        let digitsFont = NSFont.monospacedDigitSystemFont(ofSize: 30, weight: .semibold)
        digits.font = digitsFont
        digits.textColor = .labelColor
        digits.isSelectable = true
        digits.setContentCompressionResistancePriority(.required, for: .horizontal)
        digits.setContentHuggingPriority(.required, for: .horizontal)

        let open = PillButton(title: L10n.tr("Ouvrir le mail", "Open email"), symbol: nil, primary: false)

        for view in [icon, label, close, digits, open, copyButton] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        countdown.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.85).cgColor
        countdown.anchorPoint = .zero
        layer?.addSublayer(countdown)

        let p = Self.padding
        NSLayoutConstraint.activate([
            widthAnchor.constraint(greaterThanOrEqualToConstant: 360),

            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: p),
            icon.topAnchor.constraint(equalTo: topAnchor, constant: 14),
            icon.widthAnchor.constraint(equalToConstant: 18),
            icon.heightAnchor.constraint(equalToConstant: 18),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 7),
            label.centerYAnchor.constraint(equalTo: icon.centerYAnchor),
            label.trailingAnchor.constraint(lessThanOrEqualTo: close.leadingAnchor, constant: -8),
            close.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            close.centerYAnchor.constraint(equalTo: icon.centerYAnchor),
            close.widthAnchor.constraint(equalToConstant: 16),
            close.heightAnchor.constraint(equalToConstant: 16),

            digits.leadingAnchor.constraint(equalTo: leadingAnchor, constant: p - 1),
            digits.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 6),
            digits.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            copyButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -p),
            // Buttons centred on the digits themselves (baseline − half the cap height), not their box.
            copyButton.centerYAnchor.constraint(equalTo: digits.firstBaselineAnchor, constant: -digitsFont.capHeight / 2),
            open.trailingAnchor.constraint(equalTo: copyButton.leadingAnchor, constant: -8),
            open.centerYAnchor.constraint(equalTo: copyButton.centerYAnchor),
            open.leadingAnchor.constraint(greaterThanOrEqualTo: digits.trailingAnchor, constant: 18),
        ])

        copyButton.onClick = { [weak self] in self?.onCopy() }
        open.onClick = { [weak self] in self?.onOpen() }
        close.target = self
        close.action = #selector(closeClicked)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// « 736 606 »: easier to read and type than six digits in a row.
    static func spaced(_ code: String) -> String {
        guard code.count == 6, code.allSatisfy(\.isNumber) else { return code }
        return "\(code.prefix(3)) \(code.suffix(3))"
    }

    override func layout() {
        super.layout()
        if countdown.animation(forKey: "run") == nil { countdown.bounds.size = CGSize(width: countdown.bounds.width == 0 ? bounds.width : countdown.bounds.width, height: 2) }
        countdown.position = .zero
    }

    /// The bar runs out over `seconds`.
    func runCountdown(_ seconds: TimeInterval) {
        countdown.removeAllAnimations()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        countdown.bounds = CGRect(x: 0, y: 0, width: 0, height: 2)
        CATransaction.commit()
        let run = CABasicAnimation(keyPath: "bounds.size.width")
        run.fromValue = bounds.width
        run.toValue = 0
        run.duration = seconds
        countdown.add(run, forKey: "run")
    }

    /// Full again while the pointer is on the card.
    func resetCountdown() {
        countdown.removeAllAnimations()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        countdown.bounds = CGRect(x: 0, y: 0, width: bounds.width, height: 2)
        CATransaction.commit()
    }

    func showCopied() {
        copyButton.update(title: L10n.tr("Copié", "Copied"), symbol: "checkmark", fill: .systemGreen)
    }

    @objc private func closeClicked() { onClose() }
    override func mouseEntered(with event: NSEvent) { onHover(true) }
    override func mouseExited(with event: NSEvent) { onHover(false) }
    // The card never takes focus from the app in use, but its buttons work on the first click.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// A rounded button drawn by hand, so the text sits exactly on the button's optical centre (cap
/// height, not the line box) and the small symbol lines up with it.
final class PillButton: NSView {
    var onClick: (() -> Void)?
    private let label = NSTextField(labelWithString: "")
    private let icon = NSImageView()
    private let primary: Bool
    private var fill: NSColor
    private var hovering = false
    private var pressed = false
    private var filled = false
    private static let height: CGFloat = 32
    private static let font = NSFont.systemFont(ofSize: 13, weight: .medium)

    init(title: String, symbol: String?, primary: Bool) {
        self.primary = primary
        fill = primary ? .controlAccentColor : .labelColor.withAlphaComponent(0.1)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = Self.height / 2
        layer?.cornerCurve = .continuous
        label.font = Self.font
        label.textColor = primary ? .white : .labelColor
        icon.contentTintColor = label.textColor
        icon.imageScaling = .scaleNone
        for view in [icon, label] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        // Baseline at centre + half the cap height: capitals sit exactly in the middle.
        let capOffset = (Self.font.capHeight / 2).rounded(.toNearestOrAwayFromZero)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: Self.height),
            label.firstBaselineAnchor.constraint(equalTo: centerYAnchor, constant: capOffset),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.trailingAnchor.constraint(equalTo: label.leadingAnchor, constant: -6),
        ])
        leadingConstraint = (symbol == nil ? label : icon).leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14)
        leadingConstraint?.isActive = true
        update(title: title, symbol: symbol, fill: nil)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
        setAccessibilityRole(.button)
    }

    private var leadingConstraint: NSLayoutConstraint?

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func update(title: String, symbol: String?, fill newFill: NSColor?) {
        label.stringValue = title
        setAccessibilityLabel(title)
        icon.image = symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 11, weight: .medium, scale: .small)) }
        icon.isHidden = icon.image == nil
        if let newFill {
            fill = newFill
            filled = true
            label.textColor = .white
            icon.contentTintColor = .white
        }
        needsDisplay = true
    }

    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        // Hover lightens, a press darkens, in both themes (colours resolved in the card's appearance).
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        effectiveAppearance.performAsCurrentDrawingAppearance {
            // The neutral button: a soft grey in light mode, a lifted grey in dark mode.
            var color = primary || filled ? fill : NSColor(white: dark ? 1 : 0, alpha: dark ? 0.1 : 0.07)
            if pressed { color = color.blended(withFraction: 0.18, of: .black) ?? color }
            else if hovering { color = primary || filled ? (color.blended(withFraction: 0.12, of: .white) ?? color) : NSColor(white: dark ? 1 : 0, alpha: dark ? 0.16 : 0.11) }
            layer?.backgroundColor = color.cgColor
        }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    override func mouseEntered(with event: NSEvent) { hovering = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovering = false; pressed = false; needsDisplay = true }
    override func mouseDown(with event: NSEvent) { pressed = true; needsDisplay = true }
    override func mouseUp(with event: NSEvent) {
        let inside = bounds.contains(convert(event.locationInWindow, from: nil))
        pressed = false
        needsDisplay = true
        if inside { onClick?() }
    }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func accessibilityPerformPress() -> Bool { onClick?(); return true }
}
