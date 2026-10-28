import AppKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate() // NSApp.delegate is weak; this local lives for the whole run loop
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
