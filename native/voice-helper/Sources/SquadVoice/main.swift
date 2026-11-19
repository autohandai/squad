// squad-voice: on-device dictation for Autohand Squad (ADR-0260).
//
// Records from the microphone with AVAudioEngine and transcribes with NVIDIA
// Parakeet TDT v3 on the Neural Engine, through FluidAudio. Nothing leaves the
// computer. The Squad bridge runs it and speaks JSON lines over stdio:
//
//   squad-voice status            → {"modelReady":bool,"modelDirectory":"…"}
//   squad-voice prepare           → {"event":"progress","fraction":0.42} … {"event":"ready"}
//   squad-voice listen            → {"event":"listening"}; then on a line "stop"
//                                   on stdin → {"event":"text","text":"…"}
//                                   ("cancel" ends with {"event":"cancelled"})
//   squad-voice transcribe <file> → {"event":"text","text":"…"}
//
// Any failure is {"event":"error","code":"…","message":"…"} and exit 1.
import AVFoundation
import FluidAudio
import Foundation

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["event": "error", "code": code, "message": message])
    exit(1)
}

let version: AsrModelVersion = .v3
let modelDirectory = AsrModels.defaultCacheDirectory(for: version)

func modelReady() -> Bool { AsrModels.modelsExist(at: modelDirectory, version: version) }

func loadManager() async throws -> AsrManager {
    guard modelReady() else { fail("model_missing", "The Parakeet model is not on this computer yet. Download it in Settings › Voice.") }
    let models = try await AsrModels.downloadAndLoad(version: version)
    let manager = AsrManager(config: .default)
    try await manager.loadModels(models)
    return manager
}

func transcribe(_ url: URL, with manager: AsrManager) async throws -> String {
    var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
    let result = try await manager.transcribe(url, decoderState: &state)
    return result.text.trimmingCharacters(in: .whitespacesAndNewlines)
}

func microphoneAllowed() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return true
    case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
    default: return false
    }
}

final class Once: @unchecked Sendable {
    private var done = false
    private let lock = NSLock()
    func claim() -> Bool { lock.lock(); defer { lock.unlock() }; if done { return false }; done = true; return true }
}

/// Reads stdin lines on a background thread and hands each to `onLine`.
func readCommands(_ onLine: @escaping @Sendable (String) -> Void) {
    Thread.detachNewThread {
        while let line = readLine() { onLine(line.trimmingCharacters(in: .whitespacesAndNewlines)) }
        onLine("cancel") // the bridge went away
    }
}

func listen() async {
    guard await microphoneAllowed() else {
        fail("microphone_denied", "Microphone access is off for Autohand Squad. Turn it on in System Settings › Privacy & Security › Microphone.")
    }
    let manager: AsrManager
    do { manager = try await loadManager() } catch { fail("model_load", "The Parakeet model could not be loaded: \(error.localizedDescription)") }

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { fail("no_microphone", "No microphone is available.") }
    let recording = FileManager.default.temporaryDirectory.appendingPathComponent("squad-voice-\(UUID().uuidString).caf")
    defer { try? FileManager.default.removeItem(at: recording) }
    let file: AVAudioFile
    do { file = try AVAudioFile(forWriting: recording, settings: format.settings) } catch { fail("record", "Recording could not start: \(error.localizedDescription)") }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in try? file.write(from: buffer) }
    do { try engine.start() } catch { fail("record", "The microphone could not start: \(error.localizedDescription)") }
    emit(["event": "listening"])

    let command: String = await withCheckedContinuation { continuation in
        let once = Once()
        readCommands { line in
            guard line == "stop" || line == "cancel" else { return }
            if once.claim() { continuation.resume(returning: line) }
        }
    }
    input.removeTap(onBus: 0)
    engine.stop()
    if command == "cancel" { emit(["event": "cancelled"]); return }
    do {
        let text = try await transcribe(recording, with: manager)
        emit(["event": "text", "text": text])
    } catch {
        fail("transcribe", "Transcription failed: \(error.localizedDescription)")
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "status":
    emit(["modelReady": modelReady(), "modelDirectory": modelDirectory.path, "model": "parakeet-tdt-0.6b-v3"])
case "prepare":
    do {
        _ = try await AsrModels.download(version: version) { progress in
            emit(["event": "progress", "fraction": progress.fractionCompleted])
        }
        emit(["event": "ready"])
    } catch {
        fail("download", "The Parakeet model could not be downloaded: \(error.localizedDescription)")
    }
case "listen":
    await listen()
case "transcribe":
    guard arguments.count >= 2 else { fail("usage", "squad-voice transcribe <audio file>") }
    do {
        let manager = try await loadManager()
        emit(["event": "text", "text": try await transcribe(URL(fileURLWithPath: arguments[1]), with: manager)])
    } catch {
        fail("transcribe", "Transcription failed: \(error.localizedDescription)")
    }
default:
    fail("usage", "squad-voice status | prepare | listen | transcribe <file>")
}
