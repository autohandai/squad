import Foundation

/// The record contract shared with Squad for iPhone
/// (`squad-mobile/Sources/SquadMobileCore/Cloud/CloudRecords.swift`).
/// Field names, zone and container must stay identical on both sides.
public enum CloudContract {
    public static let container = "iCloud.ai.autohand.squad"
    public static let zone = "squad-mobile"
    public static let packetType = "Packet"
    public static let offerType = "PairingOffer"
    /// A request older than its `expiresAt` is refused unread; replies get
    /// the same lifetime.
    public static let packetLifetime: TimeInterval = 600
    /// Anything this far past `expiresAt` is garbage either end may delete.
    public static let sweepGrace: TimeInterval = 3600
}

public enum CloudLimits {
    /// CKRecord non-asset data must not exceed 1 MB.
    public static let inlinePayloadBytes = 900_000
    /// `limitExceeded`: 400 items per operation.
    public static let itemsPerOperation = 400
    /// `limitExceeded`: 2 MB per request, not counting assets.
    public static let bytesPerRequest = 1_900_000
    /// The host's reply cap plus the packet envelope.
    public static let maxPacketBytes = 2_900_000
}

public enum CloudAddress: Hashable, Sendable {
    case mac(computerID: String)
    case phone(peerID: String)
    public var field: String {
        switch self {
        case .mac(let id): "mac:\(id)"
        case .phone(let id): "phone:\(id)"
        }
    }
    public init?(field: String) {
        if field.hasPrefix("mac:"), field.count > 4 { self = .mac(computerID: String(field.dropFirst(4))) }
        else if field.hasPrefix("phone:"), field.count > 6 { self = .phone(peerID: String(field.dropFirst(6))) }
        else { return nil }
    }
}

/// One `Packet` record: `payload` is the sealed `MobilePacket` JSON exactly
/// as the HTTP route carries it, in `encryptedValues["packet"]` up to 900 KB
/// and as the `asset` field above. `status` is a refusal with no payload;
/// `inReplyTo` names the request record a reply answers.
public struct CloudPacketRecord: Equatable, Sendable {
    public enum Storage: Equatable, Sendable { case inline, asset }
    public var recordName: String
    public var to: CloudAddress
    public var expiresAt: Date
    public var payload: Data?
    public var status: Int?
    public var inReplyTo: String?
    /// CloudKit's creation time (a system field, read only), to measure how
    /// long a request waited before this Mac saw it.
    public var createdAt: Date?

    public init(recordName: String = UUID().uuidString.lowercased(), to: CloudAddress, expiresAt: Date, payload: Data?,
                status: Int? = nil, inReplyTo: String? = nil, createdAt: Date? = nil) {
        self.recordName = recordName; self.to = to; self.expiresAt = expiresAt; self.payload = payload
        self.status = status; self.inReplyTo = inReplyTo; self.createdAt = createdAt
    }
    public var storage: Storage { (payload?.count ?? 0) > CloudLimits.inlinePayloadBytes ? .asset : .inline }
    public var requestBytes: Int { storage == .inline ? (payload?.count ?? 0) + 256 : 256 }
}

/// The pairing offer published on an explicit "Connect a phone" click.
public struct CloudPairingOfferRecord: Equatable, Sendable {
    public var recordName: String
    public var computerID: String
    public var computerName: String
    public var expiresAt: Date
    /// The QR's offer JSON, key included; stored in `encryptedValues`.
    public var offer: Data
    public init(recordName: String, computerID: String, computerName: String, expiresAt: Date, offer: Data) {
        self.recordName = recordName; self.computerID = computerID; self.computerName = computerName
        self.expiresAt = expiresAt; self.offer = offer
    }
}

public func cloudBatches(_ records: [CloudPacketRecord]) -> [[CloudPacketRecord]] {
    var batches: [[CloudPacketRecord]] = [], current: [CloudPacketRecord] = [], bytes = 0
    for record in records {
        let size = record.requestBytes
        if !current.isEmpty, current.count == CloudLimits.itemsPerOperation || bytes + size > CloudLimits.bytesPerRequest {
            batches.append(current); current = []; bytes = 0
        }
        current.append(record); bytes += size
    }
    if !current.isEmpty { batches.append(current) }
    return batches
}

public func cloudDeleteBatches(_ names: [String]) -> [[String]] {
    stride(from: 0, to: names.count, by: CloudLimits.itemsPerOperation).map {
        Array(names[$0..<min($0 + CloudLimits.itemsPerOperation, names.count)])
    }
}
