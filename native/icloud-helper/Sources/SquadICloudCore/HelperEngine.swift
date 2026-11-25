import Foundation

/// The Mac's side of the iCloud transport (ADR-0007 option A, Squad ADR-0255).
///
/// It reads `Packet` records addressed `mac:<computerID>`, hands each
/// unexpired one to the bridge once (`packet.in`), writes the bridge's reply
/// addressed `phone:<peerID>` with `inReplyTo`, and deletes the request.
/// It never opens a packet: keys stay in the Node service.
public actor HelperEngine {
    private let store: any CloudPacketStore
    private let emit: @Sendable (WireOut) -> Void
    private let retry: CloudRetryPolicy
    private let sleep: CloudSleep
    private let clock: @Sendable () -> Date
    private var computerID: String?
    private var token: Data?
    private var zoneReady = false
    private var fetching: Task<Void, Never>?
    /// Requests handed to the bridge and not yet answered, by record name.
    private var inflight: Set<String> = []
    private var offer: String?
    private var lastState = ""
    public private(set) var stats = HelperStats()

    public init(store: any CloudPacketStore, emit: @escaping @Sendable (WireOut) -> Void, retry: CloudRetryPolicy = CloudRetryPolicy(),
                sleep: @escaping CloudSleep = cloudTaskSleep, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.store = store; self.emit = emit; self.retry = retry; self.sleep = sleep; self.clock = clock
    }

    public func handle(_ message: WireIn) async {
        do {
            switch message {
            case .start(let id):
                computerID = id
                try await prepare()
                report("ready", "iCloud is ready.")
                await poll()
                try await sweep()
            case .poll: await poll()
            case .reply(let request, let peer, let packet, let status): try await reply(to: request, peerID: peer, packet: packet, status: status)
            case .publishOffer(let record):
                try await prepare()
                if let previous = offer, previous != record.recordName { try? await withRetry { try await self.store.deleteOffer(previous) } }
                try await withRetry { try await self.store.saveOffer(record) }
                offer = record.recordName
            case .withdrawOffer:
                if let previous = offer { try await withRetry { try await self.store.deleteOffer(previous) } }
                offer = nil
            case .revoke(let peer):
                let names = try await withRetry { try await self.store.addressed(to: .phone(peerID: peer)) }
                try await deleteAll(names)
            case .stats: emit(.stats(stats))
            case .stop: break
            }
        } catch let error as CloudStoreError {
            report(error.state, error.detail)
        } catch {
            emit(.error(error.localizedDescription))
        }
    }

    /// A CloudKit push arrived: it only means "the zone changed".
    public func pushed() async {
        stats.pushes += 1
        await poll()
    }

    /// Fetches zone changes; concurrent callers share one fetch.
    public func poll() async {
        if let fetching { return await fetching.value }
        let task = Task { await self.fetchAll() }
        fetching = task
        await task.value
        fetching = nil
    }

    @discardableResult
    public func sweep() async throws -> Int {
        let cutoff = clock().addingTimeInterval(-CloudContract.sweepGrace)
        let names = try await withRetry { try await self.store.expired(before: cutoff) }
        try await deleteAll(names)
        stats.swept += names.count
        return names.count
    }

    // MARK: - Internals

    private func fetchAll() async {
        guard let computerID else { return }
        stats.polls += 1
        do {
            try await prepare()
            var more = true
            while more {
                let changes: CloudChanges
                do { changes = try await withRetry { try await self.store.changes(since: self.token) } }
                catch CloudStoreError.changeTokenExpired { token = nil; continue }
                token = changes.token
                more = changes.moreComing
                var refused: [String] = []
                let now = clock()
                for record in changes.records {
                    guard record.to == .mac(computerID: computerID), !inflight.contains(record.recordName) else { continue }
                    // Past its expiry nobody waits for it: refuse it unread
                    // (ADR-0007 Security, "Replay and dedup").
                    if record.expiresAt <= now { refused.append(record.recordName); stats.refusedExpired += 1; continue }
                    guard let payload = record.payload else { refused.append(record.recordName); continue }
                    inflight.insert(record.recordName)
                    stats.received += 1
                    let age = record.createdAt.map { Int(now.timeIntervalSince($0) * 1000) }
                    emit(.packetIn(id: record.recordName, packet: payload, ageMs: age))
                }
                if !refused.isEmpty { try await deleteAll(refused) }
            }
            report("ready", "iCloud is ready.")
        } catch let error as CloudStoreError {
            report(error.state, error.detail)
        } catch {
            report("error", error.localizedDescription)
        }
    }

    private func reply(to request: String, peerID: String, packet: Data?, status: Int?) async throws {
        guard inflight.contains(request) else { return }
        let record = CloudPacketRecord(to: .phone(peerID: peerID), expiresAt: clock().addingTimeInterval(CloudContract.packetLifetime),
                                       payload: packet, status: status, inReplyTo: request)
        try await withRetry { try await self.store.save([record]) }
        inflight.remove(request)
        stats.replied += 1
        // The reply is written; losing the delete only leaves work for the
        // sweep, and a re-read request gets the service's stored receipt.
        try? await withRetry { try await self.store.delete([request]) }
    }

    private func prepare() async throws {
        guard !zoneReady else { return }
        try await withRetry { try await self.store.prepareZone() }
        zoneReady = true
    }

    private func deleteAll(_ names: [String]) async throws {
        for batch in cloudDeleteBatches(names) { try await withRetry { try await self.store.delete(batch) } }
    }

    private func report(_ state: String, _ detail: String) {
        guard state != lastState else { return }
        lastState = state
        emit(.status(state: state, detail: detail))
    }

    private func withRetry<T: Sendable>(_ operation: @Sendable () async throws -> T) async throws -> T {
        var attempt = 0, rebuilt = false
        while true {
            do { return try await operation() }
            catch let error as CloudStoreError {
                if error == .zoneMissing, !rebuilt {
                    rebuilt = true; zoneReady = false; token = nil
                    try await store.prepareZone(); zoneReady = true
                    continue
                }
                guard let delay = retry.delay(after: error, attempt: attempt) else { throw error }
                stats.rateLimited += 1; stats.retryAfterTotal += delay
                attempt += 1
                try await sleep(delay)
            }
        }
    }
}
