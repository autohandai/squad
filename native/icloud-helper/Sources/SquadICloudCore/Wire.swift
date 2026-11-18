import Foundation

/// Newline-delimited JSON between the Squad bridge (Node, `server/mobile/icloud.mjs`)
/// and this helper, over the helper's stdin/stdout. One object per line.
public enum WireIn: Equatable, Sendable {
    /// Which computer this Mac is; packets addressed `mac:<computerID>` are read.
    case start(computerID: String)
    /// Fetch changes now (the bridge saw the Mac wake, or wants a check).
    case poll
    /// The service's answer to `packet.in <inReplyTo>`: the sealed reply
    /// packet, or the HTTP-equivalent status when the service refused it.
    case reply(inReplyTo: String, peerID: String, packet: Data?, status: Int?)
    case publishOffer(CloudPairingOfferRecord)
    case withdrawOffer
    /// Delete every packet addressed to this phone (it was revoked).
    case revoke(peerID: String)
    case stats
    case stop

    public static func parse(_ line: Data) throws -> WireIn {
        guard let object = try JSONSerialization.jsonObject(with: line) as? [String: Any], let op = object["op"] as? String else {
            throw WireError.invalid("Expected a JSON object with an op.")
        }
        let text = { (key: String) throws -> String in
            guard let value = object[key] as? String, !value.isEmpty, value.count <= 200 else { throw WireError.invalid("\(op) needs \(key).") }
            return value
        }
        switch op {
        case "start": return .start(computerID: try text("computerID"))
        case "poll": return .poll
        case "packet.out":
            let packet = try (object["packet"] as? [String: Any]).map { try JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }
            let status = (object["status"] as? NSNumber)?.intValue
            guard (packet == nil) != (status == nil) else { throw WireError.invalid("packet.out needs a packet or a status, not both.") }
            if let packet, packet.count > CloudLimits.maxPacketBytes { throw WireError.invalid("The reply is too large for iCloud.") }
            return .reply(inReplyTo: try text("inReplyTo"), peerID: try text("peerID"), packet: packet, status: status)
        case "offer.publish":
            guard let offer = object["offer"] as? [String: Any], let computerID = offer["computerID"] as? String,
                  let computerName = offer["computerName"] as? String, let expiresAt = (offer["expiresAt"] as? NSNumber)?.doubleValue,
                  let pairingID = offer["pairingID"] as? String else { throw WireError.invalid("offer.publish needs the QR offer.") }
            return .publishOffer(CloudPairingOfferRecord(recordName: "offer-\(pairingID)", computerID: computerID, computerName: computerName,
                expiresAt: Date(timeIntervalSince1970: expiresAt), offer: try JSONSerialization.data(withJSONObject: offer, options: [.sortedKeys])))
        case "offer.withdraw": return .withdrawOffer
        case "revoke": return .revoke(peerID: try text("peerID"))
        case "stats": return .stats
        case "stop": return .stop
        default: throw WireError.invalid("Unknown op \(op).")
        }
    }
}

public enum WireError: Error, Equatable { case invalid(String) }

public enum WireOut: Sendable, Equatable {
    case status(state: String, detail: String)
    /// A request for the service. `ageMs` is how long the record existed in
    /// iCloud before this Mac read it (push or poll latency, for phase 1).
    case packetIn(id: String, packet: Data, ageMs: Int?)
    case stats(HelperStats)
    case error(String)

    public func line() -> Data {
        var object: [String: Any]
        switch self {
        case .status(let state, let detail): object = ["op": "status", "state": state, "detail": detail]
        case .packetIn(let id, let packet, let age):
            object = ["op": "packet.in", "id": id, "packet": (try? JSONSerialization.jsonObject(with: packet)) ?? NSNull()]
            if let age { object["ageMs"] = age }
        case .stats(let stats):
            object = ["op": "stats", "received": stats.received, "replied": stats.replied, "refusedExpired": stats.refusedExpired,
                      "rateLimited": stats.rateLimited, "retryAfterTotal": stats.retryAfterTotal, "swept": stats.swept,
                      "polls": stats.polls, "pushes": stats.pushes]
        case .error(let detail): object = ["op": "error", "detail": detail]
        }
        var data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data(#"{"op":"error"}"#.utf8)
        data.append(0x0A)
        return data
    }
}

public struct HelperStats: Sendable, Equatable {
    public var received = 0
    public var replied = 0
    public var refusedExpired = 0
    public var rateLimited = 0
    public var retryAfterTotal: Double = 0
    public var swept = 0
    public var polls = 0
    public var pushes = 0
    public init() {}
}
