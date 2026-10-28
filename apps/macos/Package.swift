// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "ZMail",
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(
            name: "ZMail",
            path: "Sources/ZMail",
            swiftSettings: [.enableUpcomingFeature("StrictConcurrency")]
        ),
    ]
)
