import XCTest
@testable import SquadICloudCore

final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_800_000_000)
    private(set) var sleeps: [TimeInterval] = []
    var now: Date { lock.withLock { current } }
    var sleep: CloudSleep { { [self] seconds in lock.withLock { current += seconds; sleeps.append(seconds) } } }
    var clock: @Sendable () -> Date { { [self] in now } }
}

/// One private-database zone in memory. No Apple Account, no network.
final class FakeStore: CloudPacketStore, @unchecked Sendable {
    enum Op: Hashable { case prepare, save, delete, changes, expired, addressed, offer, deleteOffer }
    private let lock = NSLock()
    private(set) var records: [String: CloudPacketRecord] = [:]
    private(set) var offers: [String: CloudPairingOfferRecord] = [:]
    private var log: [(Int, String)] = []
    private var seq = 0
    var failures: [Op: [CloudStoreError]] = [:]
    var calls: [Op: Int] = [:]

    func put(_ record: CloudPacketRecord) { lock.withLock { seq += 1; records[record.recordName] = record; log.append((seq, record.recordName)) } }
    private func step(_ op: Op) throws {
        try lock.withLock {
            calls[op, default: 0] += 1
            if var list = failures[op], !list.isEmpty { let error = list.removeFirst(); failures[op] = list; throw error }
        }
    }
    func prepareZone() async throws { try step(.prepare) }
    func save(_ batch: [CloudPacketRecord]) async throws {
        try step(.save)
        XCTAssertLessThanOrEqual(batch.count, CloudLimits.itemsPerOperation)
        for record in batch { put(record) }
    }
    func delete(_ names: [String]) async throws {
        try step(.delete)
        XCTAssertLessThanOrEqual(names.count, CloudLimits.itemsPerOperation)
        lock.withLock { for name in names { records.removeValue(forKey: name) } }
    }
    func changes(since token: Data?) async throws -> CloudChanges {
        try step(.changes)
        return lock.withLock {
            let since = token.flatMap { Int(String(decoding: $0, as: UTF8.self)) } ?? 0
            let names = Set(log.filter { $0.0 > since }.map(\.1))
            return CloudChanges(records: names.compactMap { records[$0] }, token: Data(String(seq).utf8))
        }
    }
    func expired(before date: Date) async throws -> [String] {
        try step(.expired); return lock.withLock { records.values.filter { $0.expiresAt < date }.map(\.recordName) }
    }
    func addressed(to address: CloudAddress) async throws -> [String] {
        try step(.addressed); return lock.withLock { records.values.filter { $0.to == address }.map(\.recordName) }
    }
    func saveOffer(_ offer: CloudPairingOfferRecord) async throws { try step(.offer); lock.withLock { offers[offer.recordName] = offer } }
    func deleteOffer(_ name: String) async throws { try step(.deleteOffer); lock.withLock { _ = offers.removeValue(forKey: name) } }
}

final class Emitted: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [WireOut] = []
    var all: [WireOut] { lock.withLock { items } }
    var emit: @Sendable (WireOut) -> Void { { [self] message in lock.withLock { items.append(message) } } }
    var packets: [(id: String, packet: Data, age: Int?)] {
        all.compactMap { if case .packetIn(let id, let packet, let age) = $0 { (id, packet, age) } else { nil } }
    }
    var states: [String] { all.compactMap { if case .status(let state, _) = $0 { state } else { nil } } }
}

final class HelperEngineTests: XCTestCase {
    let packet = Data(#"{"computerID":"c1","kind":"device","peerID":"p1","requestID":"r1","sealed":"AAAA","version":1}"#.utf8)

    func request(_ name: String, to: CloudAddress = .mac(computerID: "c1"), expiresIn: TimeInterval = 600, clock: TestClock, payload: Data? = nil) -> CloudPacketRecord {
        CloudPacketRecord(recordName: name, to: to, expiresAt: clock.now.addingTimeInterval(expiresIn), payload: payload ?? packet,
                          createdAt: clock.now.addingTimeInterval(-1.5))
    }

    func testReadsOnlyThisComputersFreshRequestsOnce() async {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        store.put(request("mine", clock: clock))
        store.put(request("other-mac", to: .mac(computerID: "c2"), clock: clock))
        store.put(request("a-reply", to: .phone(peerID: "p1"), clock: clock))
        store.put(request("stale", expiresIn: -1, clock: clock))
        await engine.handle(.start(computerID: "c1"))
        await engine.poll()
        XCTAssertEqual(out.packets.map(\.id), ["mine"], "read once, even when fetched twice")
        XCTAssertEqual(out.packets.first?.packet, packet, "the packet is passed through, never opened")
        XCTAssertEqual(out.packets.first?.age, 1500)
        XCTAssertNil(store.records["stale"], "an expired request is refused unread and deleted")
        XCTAssertNotNil(store.records["other-mac"])
        XCTAssertNotNil(store.records["a-reply"])
        XCTAssertEqual(out.states.first, "ready")
        let stats = await engine.stats
        XCTAssertEqual(stats.refusedExpired, 1)
        XCTAssertEqual(stats.received, 1)
    }

    func testReplyIsAddressedToThePhoneAndRemovesTheRequest() async throws {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        store.put(request("req", clock: clock))
        await engine.handle(.start(computerID: "c1"))
        let reply = Data(#"{"sealed":"BBBB"}"#.utf8)
        await engine.handle(.reply(inReplyTo: "req", peerID: "p1", packet: reply, status: nil))
        XCTAssertNil(store.records["req"])
        let written = try XCTUnwrap(store.records.values.first)
        XCTAssertEqual(written.to, .phone(peerID: "p1"))
        XCTAssertEqual(written.inReplyTo, "req")
        XCTAssertEqual(written.payload, reply)
        XCTAssertEqual(written.expiresAt, clock.now.addingTimeInterval(600))
        XCTAssertNotEqual(written.recordName, "req")
        // A second answer for the same request is ignored.
        await engine.handle(.reply(inReplyTo: "req", peerID: "p1", packet: reply, status: nil))
        XCTAssertEqual(store.records.count, 1)
    }

    func testRefusalTravelsAsAStatus() async {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        store.put(request("req", clock: clock))
        await engine.handle(.start(computerID: "c1"))
        await engine.handle(.reply(inReplyTo: "req", peerID: "p1", packet: nil, status: 401))
        XCTAssertEqual(store.records.values.first?.status, 401)
        XCTAssertNil(store.records.values.first?.payload)
    }

    func testRateLimitedReplyWaitsAndIsCounted() async {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        store.put(request("req", clock: clock))
        await engine.handle(.start(computerID: "c1"))
        store.failures[.save] = [.rateLimited(retryAfter: 4)]
        await engine.handle(.reply(inReplyTo: "req", peerID: "p1", packet: packet, status: nil))
        XCTAssertEqual(clock.sleeps, [4])
        let stats = await engine.stats
        XCTAssertEqual(stats.rateLimited, 1)
        XCTAssertEqual(stats.replied, 1)
    }

    func testAccountAndQuotaProblemsBecomeStatus() async {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        store.failures[.prepare] = [.notSignedIn]
        await engine.handle(.start(computerID: "c1"))
        XCTAssertEqual(out.states, ["noAccount"])
        store.put(request("req", clock: clock))
        await engine.poll()
        XCTAssertEqual(out.states, ["noAccount", "ready"])
        store.failures[.changes] = [.quotaExceeded]
        store.put(request("req2", clock: clock))
        await engine.poll()
        XCTAssertEqual(out.states.last, "quotaExceeded")
    }

    func testExpiredTokenAndDeletedZoneRecover() async {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        store.failures[.changes] = [.changeTokenExpired, .zoneMissing]
        store.put(request("req", clock: clock))
        await engine.handle(.start(computerID: "c1"))
        XCTAssertEqual(out.packets.map(\.id), ["req"])
        XCTAssertEqual(store.calls[.prepare], 2)
    }

    func testSweepAndRevokeDeleteInBatches() async throws {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        for index in 0..<850 { store.put(request("old-\(index)", to: .phone(peerID: "p9"), expiresIn: -4000, clock: clock)) }
        store.put(request("recent", to: .phone(peerID: "p9"), expiresIn: -10, clock: clock))
        store.put(request("p2-reply", to: .phone(peerID: "p2"), clock: clock))
        let swept = try await engine.sweep()
        XCTAssertEqual(swept, 850)
        XCTAssertEqual(Set(store.records.keys), ["recent", "p2-reply"])
        await engine.handle(.revoke(peerID: "p9"))
        XCTAssertEqual(Set(store.records.keys), ["p2-reply"])
    }

    func testOfferIsPublishedReplacedAndWithdrawn() async {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        let first = CloudPairingOfferRecord(recordName: "offer-a", computerID: "c1", computerName: "Studio", expiresAt: clock.now + 600, offer: Data("{}".utf8))
        await engine.handle(.publishOffer(first))
        var second = first; second.recordName = "offer-b"
        await engine.handle(.publishOffer(second))
        XCTAssertEqual(Array(store.offers.keys), ["offer-b"], "one live offer at a time")
        await engine.handle(.withdrawOffer)
        XCTAssertTrue(store.offers.isEmpty)
    }

    func testPushOnlyTriggersAFetch() async {
        let clock = TestClock(), store = FakeStore(), out = Emitted()
        let engine = HelperEngine(store: store, emit: out.emit, sleep: clock.sleep, clock: clock.clock)
        await engine.handle(.start(computerID: "c1"))
        store.put(request("late", clock: clock))
        await engine.pushed()
        XCTAssertEqual(out.packets.map(\.id), ["late"])
        let stats = await engine.stats
        XCTAssertEqual(stats.pushes, 1)
    }
}

final class WireTests: XCTestCase {
    func parse(_ text: String) throws -> WireIn { try WireIn.parse(Data(text.utf8)) }

    func testParsesEveryBridgeMessage() throws {
        XCTAssertEqual(try parse(#"{"op":"start","computerID":"c1"}"#), .start(computerID: "c1"))
        XCTAssertEqual(try parse(#"{"op":"poll"}"#), .poll)
        XCTAssertEqual(try parse(#"{"op":"revoke","peerID":"p"}"#), .revoke(peerID: "p"))
        guard case .reply(let request, let peer, let packet, nil) = try parse(#"{"op":"packet.out","inReplyTo":"r","peerID":"p","packet":{"b":1,"a":2}}"#) else { return XCTFail() }
        XCTAssertEqual(request, "r"); XCTAssertEqual(peer, "p")
        XCTAssertEqual(String(decoding: packet!, as: UTF8.self), #"{"a":2,"b":1}"#)
        XCTAssertEqual(try parse(#"{"op":"packet.out","inReplyTo":"r","peerID":"p","status":429}"#), .reply(inReplyTo: "r", peerID: "p", packet: nil, status: 429))
        guard case .publishOffer(let offer) = try parse(#"{"op":"offer.publish","offer":{"version":1,"computerID":"c1","computerName":"Studio","pairingID":"x","expiresAt":1800000600,"secret":"k","endpoint":"http://10.0.0.2:29323"}}"#) else { return XCTFail() }
        XCTAssertEqual(offer.recordName, "offer-x")
        XCTAssertEqual(offer.computerName, "Studio")
        XCTAssertEqual(offer.expiresAt, Date(timeIntervalSince1970: 1_800_000_600))
    }

    func testRejectsMalformedMessages() {
        XCTAssertThrowsError(try parse("[]"))
        XCTAssertThrowsError(try parse(#"{"op":"start"}"#))
        XCTAssertThrowsError(try parse(#"{"op":"nope"}"#))
        XCTAssertThrowsError(try parse(#"{"op":"packet.out","inReplyTo":"r","peerID":"p"}"#), "needs a packet or a status")
        XCTAssertThrowsError(try parse(#"{"op":"packet.out","inReplyTo":"r","peerID":"p","status":401,"packet":{}}"#))
        let huge = String(repeating: "a", count: CloudLimits.maxPacketBytes)
        XCTAssertThrowsError(try parse(#"{"op":"packet.out","inReplyTo":"r","peerID":"p","packet":{"sealed":"\#(huge)"}}"#))
    }

    func testOutputIsOneLineOfJSON() throws {
        let line = WireOut.packetIn(id: "r", packet: Data(#"{"a":1}"#.utf8), ageMs: 12).line()
        XCTAssertEqual(line.last, 0x0A)
        XCTAssertEqual(line.filter { $0 == 0x0A }.count, 1)
        let object = try JSONSerialization.jsonObject(with: line.dropLast()) as? [String: Any]
        XCTAssertEqual(object?["op"] as? String, "packet.in")
        XCTAssertEqual((object?["packet"] as? [String: Any])?["a"] as? Int, 1)
        XCTAssertEqual(object?["ageMs"] as? Int, 12)
    }

    func testBatchesAndLimits() {
        let small = (0..<1000).map { _ in CloudPacketRecord(to: .mac(computerID: "c"), expiresAt: Date(), payload: Data(count: 10)) }
        XCTAssertEqual(cloudBatches(small).map(\.count), [400, 400, 200])
        let inline = (0..<5).map { _ in CloudPacketRecord(to: .mac(computerID: "c"), expiresAt: Date(), payload: Data(count: 850_000)) }
        XCTAssertEqual(cloudBatches(inline).map(\.count), [2, 2, 1])
        XCTAssertEqual(CloudPacketRecord(to: .mac(computerID: "c"), expiresAt: Date(), payload: Data(count: 1_000_000)).storage, .asset)
        XCTAssertEqual(cloudDeleteBatches((0..<401).map(String.init)).map(\.count), [400, 1])
        let policy = CloudRetryPolicy()
        XCTAssertEqual(policy.delay(after: .rateLimited(retryAfter: 9), attempt: 0), 9)
        XCTAssertEqual(policy.delay(after: .rateLimited(retryAfter: nil), attempt: 1), 2)
        XCTAssertNil(policy.delay(after: .rateLimited(retryAfter: 1), attempt: 3))
        XCTAssertNil(policy.delay(after: .quotaExceeded, attempt: 0))
    }
}
