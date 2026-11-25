// swift-tools-version: 6.0
import PackageDescription

// Squad's iCloud helper (ADR-0255, squad-mobile ADR-0007). Built into
// `Squad iCloud.app` by scripts/build-icloud-helper.mjs and nested in
// `Autohand Squad.app/Contents/Helpers/`.
let package = Package(
    name: "SquadICloud",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "SquadICloudCore"),
        .executableTarget(name: "SquadICloud", dependencies: ["SquadICloudCore"]),
        .testTarget(name: "SquadICloudCoreTests", dependencies: ["SquadICloudCore"]),
    ]
)
