import Foundation

/// What the helper needs from CloudKit; faked in tests.
public protocol CloudPacketStore: Sendable {
    func prepareZone() async throws
    func save(_ records: [CloudPacketRecord]) async throws
    func delete(_ recordNames: [String]) async throws
    func changes(since token: Data?) async throws -> CloudChanges
    func expired(before date: Date) async throws -> [String]
    /// Record names of packets addressed to `address` (revoking a phone).
    func addressed(to address: CloudAddress) async throws -> [String]
    func saveOffer(_ offer: CloudPairingOfferRecord) async throws
    func deleteOffer(_ recordName: String) async throws
}

public struct CloudChanges: Sendable {
    public var records: [CloudPacketRecord]
    public var token: Data?
    public var moreComing: Bool
    public init(records: [CloudPacketRecord], token: Data?, moreComing: Bool = false) {
        self.records = records; self.token = token; self.moreComing = moreComing
    }
}

public enum CloudStoreError: Error, Equatable, Sendable {
    case rateLimited(retryAfter: TimeInterval?)
    case quotaExceeded
    case notSignedIn
    case zoneMissing
    case changeTokenExpired
    case limitExceeded
    case network
    case other(String)

    /// The helper's `status.state` for this failure, in the bridge's words.
    public var state: String {
        switch self {
        case .notSignedIn: "noAccount"
        case .quotaExceeded: "quotaExceeded"
        case .network: "offline"
        case .rateLimited: "rateLimited"
        default: "error"
        }
    }
    public var detail: String {
        switch self {
        case .rateLimited: "iCloud asked Squad to slow down."
        case .quotaExceeded: "Your iCloud storage is full. Free up space to use iCloud for phones."
        case .notSignedIn: "Sign in to iCloud on this Mac with the same Apple Account as your phone."
        case .zoneMissing: "Squad’s iCloud space was removed; it is being set up again."
        case .changeTokenExpired: "iCloud asked Squad to start over."
        case .limitExceeded: "A request was too large for iCloud."
        case .network: "iCloud cannot be reached."
        case .other(let message): message
        }
    }
}

/// Honours CloudKit's retry-after for `requestRateLimited` / `zoneBusy` /
/// `serviceUnavailable`; exponential backoff when it gives none.
public struct CloudRetryPolicy: Sendable {
    public var attempts: Int
    public var base: TimeInterval
    public var ceiling: TimeInterval
    public init(attempts: Int = 4, base: TimeInterval = 1, ceiling: TimeInterval = 30) {
        self.attempts = attempts; self.base = base; self.ceiling = ceiling
    }
    public func delay(after error: CloudStoreError, attempt: Int) -> TimeInterval? {
        guard case .rateLimited(let retryAfter) = error, attempt + 1 < attempts else { return nil }
        if let retryAfter { return retryAfter }
        return min(ceiling, base * pow(2, Double(attempt)))
    }
}

public typealias CloudSleep = @Sendable (TimeInterval) async throws -> Void
public let cloudTaskSleep: CloudSleep = { seconds in
    try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
}
