#if canImport(CloudKit)
import CloudKit
import Foundation

/// `CloudPacketStore` over the private database. Construct it only after
/// `Entitlements.hasCloudKit` is true: CloudKit traps an unentitled process.
public final class CloudKitPacketStore: CloudPacketStore, @unchecked Sendable {
    public static let subscriptionID = "squad-mobile-zone-changes"
    private let database: CKDatabase
    private let zoneID: CKRecordZone.ID

    public init(containerIdentifier: String = CloudContract.container) {
        database = CKContainer(identifier: containerIdentifier).privateCloudDatabase
        zoneID = CKRecordZone.ID(zoneName: CloudContract.zone, ownerName: CKCurrentUserDefaultName)
    }

    public static func accountAvailable(containerIdentifier: String = CloudContract.container) async -> CKAccountStatus? {
        try? await CKContainer(identifier: containerIdentifier).accountStatus()
    }

    public func prepareZone() async throws {
        try await mapped {
            _ = try await database.modifyRecordZones(saving: [CKRecordZone(zoneID: zoneID)], deleting: [])
            // The default zone does not take part in database subscriptions,
            // hence the custom zone. A push only says "the zone changed".
            let subscription = CKDatabaseSubscription(subscriptionID: Self.subscriptionID)
            subscription.recordType = CloudContract.packetType
            let info = CKSubscription.NotificationInfo()
            info.shouldSendContentAvailable = true
            subscription.notificationInfo = info
            _ = try await database.modifySubscriptions(saving: [subscription], deleting: [])
        }
    }

    public func save(_ records: [CloudPacketRecord]) async throws {
        var files: [URL] = []
        defer { for file in files { try? FileManager.default.removeItem(at: file) } }
        for batch in cloudBatches(records) {
            let built = try batch.map { try ckRecord($0, files: &files) }
            try await mapped {
                let (results, _) = try await database.modifyRecords(saving: built, deleting: [], savePolicy: .allKeys, atomically: false)
                for (_, result) in results { if case .failure(let error) = result { throw error } }
            }
        }
    }

    public func delete(_ recordNames: [String]) async throws {
        for batch in cloudDeleteBatches(recordNames) {
            let ids = batch.map { CKRecord.ID(recordName: $0, zoneID: zoneID) }
            try await mapped {
                let (_, results) = try await database.modifyRecords(saving: [], deleting: ids, savePolicy: .allKeys, atomically: false)
                for (_, result) in results {
                    if case .failure(let error) = result, (error as? CKError)?.code != .unknownItem { throw error }
                }
            }
        }
    }

    public func changes(since token: Data?) async throws -> CloudChanges {
        let previous = token.flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: $0) }
        return try await mapped {
            let result = try await database.recordZoneChanges(inZoneWith: zoneID, since: previous)
            var records: [CloudPacketRecord] = []
            for (_, modification) in result.modificationResultsByID {
                guard case .success(let change) = modification, change.record.recordType == CloudContract.packetType,
                      let record = Self.packetRecord(change.record) else { continue }
                records.append(record)
            }
            let next = try? NSKeyedArchiver.archivedData(withRootObject: result.changeToken, requiringSecureCoding: true)
            return CloudChanges(records: records, token: next, moreComing: result.moreComing)
        }
    }

    public func expired(before date: Date) async throws -> [String] {
        try await names(matching: NSPredicate(format: "expiresAt < %@", date as NSDate))
    }

    public func addressed(to address: CloudAddress) async throws -> [String] {
        try await names(matching: NSPredicate(format: "to == %@", address.field))
    }

    public func saveOffer(_ offer: CloudPairingOfferRecord) async throws {
        let record = CKRecord(recordType: CloudContract.offerType, recordID: CKRecord.ID(recordName: offer.recordName, zoneID: zoneID))
        record["computerID"] = offer.computerID
        record["computerName"] = offer.computerName
        record["expiresAt"] = offer.expiresAt
        record.encryptedValues["offer"] = offer.offer
        try await mapped {
            let (results, _) = try await database.modifyRecords(saving: [record], deleting: [], savePolicy: .allKeys, atomically: true)
            for (_, result) in results { if case .failure(let error) = result { throw error } }
        }
    }

    public func deleteOffer(_ recordName: String) async throws { try await delete([recordName]) }

    private func names(matching predicate: NSPredicate) async throws -> [String] {
        let query = CKQuery(recordType: CloudContract.packetType, predicate: predicate)
        return try await mapped {
            var names: [String] = []
            var (results, cursor) = try await database.records(matching: query, inZoneWith: zoneID, desiredKeys: [], resultsLimit: CloudLimits.itemsPerOperation)
            names += results.map(\.0.recordName)
            while let next = cursor {
                (results, cursor) = try await database.records(continuingMatchFrom: next, desiredKeys: [], resultsLimit: CloudLimits.itemsPerOperation)
                names += results.map(\.0.recordName)
            }
            return names
        }
    }

    private func ckRecord(_ record: CloudPacketRecord, files: inout [URL]) throws -> CKRecord {
        let ck = CKRecord(recordType: CloudContract.packetType, recordID: CKRecord.ID(recordName: record.recordName, zoneID: zoneID))
        ck["to"] = record.to.field
        ck["expiresAt"] = record.expiresAt
        if let reply = record.inReplyTo { ck["inReplyTo"] = reply }
        if let status = record.status { ck["status"] = Int64(status) }
        if let payload = record.payload {
            switch record.storage {
            case .inline: ck.encryptedValues["packet"] = payload
            case .asset:
                let file = FileManager.default.temporaryDirectory.appending(path: "squad-packet-\(record.recordName).json")
                try payload.write(to: file)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
                files.append(file)
                ck["asset"] = CKAsset(fileURL: file)
            }
        }
        return ck
    }

    static func packetRecord(_ ck: CKRecord) -> CloudPacketRecord? {
        guard let to = (ck["to"] as? String).flatMap(CloudAddress.init(field:)), let expiresAt = ck["expiresAt"] as? Date else { return nil }
        var payload = ck.encryptedValues["packet"] as? Data
        if payload == nil, let url = (ck["asset"] as? CKAsset)?.fileURL { payload = try? Data(contentsOf: url) }
        return CloudPacketRecord(recordName: ck.recordID.recordName, to: to, expiresAt: expiresAt, payload: payload,
                                 status: (ck["status"] as? Int64).map(Int.init), inReplyTo: ck["inReplyTo"] as? String,
                                 createdAt: ck.creationDate)
    }

    private func mapped<T>(_ body: () async throws -> T) async throws -> T {
        do { return try await body() } catch { throw Self.map(error) }
    }

    public static func map(_ error: Error) -> CloudStoreError {
        guard let ck = error as? CKError else { return .other(error.localizedDescription) }
        if ck.code == .partialFailure, let first = ck.partialErrorsByItemID?.values.first { return map(first) }
        switch ck.code {
        case .requestRateLimited, .zoneBusy, .serviceUnavailable: return .rateLimited(retryAfter: ck.retryAfterSeconds)
        case .quotaExceeded: return .quotaExceeded
        case .notAuthenticated, .permissionFailure, .managedAccountRestricted, .accountTemporarilyUnavailable: return .notSignedIn
        case .zoneNotFound, .userDeletedZone: return .zoneMissing
        case .changeTokenExpired: return .changeTokenExpired
        case .limitExceeded: return .limitExceeded
        case .networkUnavailable, .networkFailure: return .network
        default: return .other(ck.localizedDescription)
        }
    }
}
#endif
