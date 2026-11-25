import AppKit
import CloudKit
import Security
import SquadICloudCore

// Squad iCloud.app — nested in Autohand Squad.app/Contents/Helpers and started
// by the bridge (server/mobile/icloud.mjs). It talks newline-delimited JSON
// over stdin/stdout and exits when stdin closes (the bridge went away).
// It is an app bundle, not a bare binary, because iCloud entitlements are
// restricted and need an embedded provisioning profile (ADR-0007 evidence 4).

let output = FileHandle.standardOutput
let outputLock = NSLock()
@Sendable func send(_ message: WireOut) {
    let line = message.line()
    outputLock.lock(); defer { outputLock.unlock() }
    try? output.write(contentsOf: line)
}

/// True only when this process is signed with the CloudKit container. Checked
/// before anything touches CloudKit, which traps an unentitled process.
func entitledForCloudKit() -> Bool {
    guard let task = SecTaskCreateFromSelf(nil),
          let value = SecTaskCopyValueForEntitlement(task, "com.apple.developer.icloud-container-identifiers" as CFString, nil) as? [String] else { return false }
    return value.contains(CloudContract.container)
}

final class HelperDelegate: NSObject, NSApplicationDelegate, @unchecked Sendable {
    var engine: HelperEngine?
    private var timer: Timer?
    private var sweeper: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard entitledForCloudKit() else {
            // A build without the profile (every local ad-hoc build): say so
            // and stay quiet, so the bridge keeps the other routes as they are.
            send(.status(state: "unentitled", detail: "This build of Squad is not signed for iCloud."))
            readInput { message in if message == .stop { exit(0) } }
            return
        }
        let engine = HelperEngine(store: CloudKitPacketStore(), emit: send)
        self.engine = engine
        send(.status(state: "starting", detail: "Connecting to iCloud…"))
        Task {
            if let status = await CloudKitPacketStore.accountAvailable(), status != .available {
                send(.status(state: "noAccount", detail: "Sign in to iCloud on this Mac with the same Apple Account as your phone."))
            }
        }
        NSApplication.shared.registerForRemoteNotifications()
        // The slow timer is the floor when pushes are coalesced or dropped.
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in Task { await engine.poll() } }
        sweeper = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { _ in Task { try? await engine.sweep() } }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            Task { await engine.poll() }
        }
        readInput { message in
            if message == .stop { exit(0) }
            Task { await engine.handle(message) }
        }
    }

    func application(_ application: NSApplication, didReceiveRemoteNotification userInfo: [String: Any]) {
        guard let engine else { return }
        Task { await engine.pushed() }
    }

    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Not fatal: the 60 s poll still runs. Reported so phase 1 can tell.
        send(.error("Push registration failed: \(error.localizedDescription)"))
    }

    private var buffer = Data()
    private func readInput(_ handle: @escaping @Sendable (WireIn) -> Void) {
        FileHandle.standardInput.readabilityHandler = { [weak self] file in
            let chunk = file.availableData
            if chunk.isEmpty { exit(0) } // the bridge closed our stdin
            guard let self else { return }
            self.buffer.append(chunk)
            while let newline = self.buffer.firstIndex(of: 0x0A) {
                let line = self.buffer[self.buffer.startIndex..<newline]
                self.buffer.removeSubrange(self.buffer.startIndex...newline)
                guard !line.isEmpty else { continue }
                do { handle(try WireIn.parse(Data(line))) }
                catch { send(.error("\(error)")) }
            }
        }
    }
}

let app = NSApplication.shared
let delegate = HelperDelegate()
app.delegate = delegate
app.setActivationPolicy(.prohibited)
app.run()
