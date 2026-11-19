// swift-tools-version: 5.10
// Squad Voice: on-device dictation for Autohand Squad (ADR-0260). Records the
// microphone and transcribes with Autohand Voice's own recognizer
// (AutohandVoiceCore: NVIDIA Parakeet TDT on the Neural Engine through
// FluidAudio), so Squad's dictation is Autohand Voice, not a second copy.
import PackageDescription

let package = Package(
    name: "SquadVoice",
    platforms: [.macOS(.v14)],
    dependencies: [
        // autohandai/voice (public), pinned to a reviewed commit.
        .package(url: "https://github.com/autohandai/voice.git", revision: "b9ac2978646aae716fc6e56fde42165fc87a31c1"),
    ],
    targets: [
        .executableTarget(name: "squad-voice", dependencies: [.product(name: "AutohandVoiceCore", package: "voice")], path: "Sources/SquadVoice"),
    ]
)
