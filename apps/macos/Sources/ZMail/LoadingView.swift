import AppKit

enum Theme {
    /// The web UI's sidebar colour (#131314 dark, #f7f7f8 light): what the window shows around and
    /// before the first web frame, so nothing flashes.
    static let background = NSColor(name: "ZMailBackground") { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0x13 / 255, green: 0x13 / 255, blue: 0x14 / 255, alpha: 1)
            : NSColor(srgbRed: 0xF7 / 255, green: 0xF7 / 255, blue: 0xF8 / 255, alpha: 1)
    }
}

/// Native placeholder shown while the engine boots (wordmark + small spinner).
@MainActor
final class LoadingView: NSView {
    private let spinner = NSProgressIndicator()
    private let wordmark = NSTextField(labelWithString: "ZMail")
    private let message = NSTextField(wrappingLabelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true

        wordmark.font = .systemFont(ofSize: 30, weight: .semibold)
        wordmark.textColor = .labelColor
        wordmark.alignment = .center

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isIndeterminate = true
        spinner.startAnimation(nil)

        message.font = .systemFont(ofSize: 12)
        message.textColor = .secondaryLabelColor
        message.alignment = .center
        message.isSelectable = true
        message.isHidden = true

        let stack = NSStackView(views: [wordmark, spinner, message])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -20),
            message.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {
        layer?.backgroundColor = Theme.background.cgColor
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    func showError(_ text: String?) {
        message.stringValue = text ?? ""
        message.isHidden = text == nil
    }
}
