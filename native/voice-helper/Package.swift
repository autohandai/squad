// swift-tools-version: 5.10
// Squad Voice: on-device dictation for Autohand Squad (ADR-0260). Records the
// microphone and transcribes with NVIDIA Parakeet TDT on the Neural Engine
// through FluidAudio (Apache-2.0).
import PackageDescription

let package = Package(
    name: "SquadVoice",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.7.0"),
    ],
    targets: [
        .executableTarget(name: "squad-voice", dependencies: [.product(name: "FluidAudio", package: "FluidAudio")], path: "Sources/SquadVoice"),
    ]
)
