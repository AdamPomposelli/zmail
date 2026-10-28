import Foundation
import Network

/// Loopback-only HTTP server (Network.framework) used by the Node engine to
/// reach native capabilities. One request per connection; `Connection: close`.
final class BridgeServer: @unchecked Sendable {
    typealias Handler = @Sendable (HTTPRequest) async -> HTTPResponse

    private let queue = DispatchQueue(label: "com.zippy.zmail.bridge")
    private let handler: Handler
    private var listener: NWListener?
    private(set) var port: UInt16 = 0

    init(handler: @escaping Handler) {
        self.handler = handler
    }

    /// Binds to 127.0.0.1 on `preferredPort` if free, otherwise an ephemeral port.
    /// Returns once the listener is ready.
    func start(preferredPort: UInt16 = 47811) async throws -> UInt16 {
        let chosen = PortUtil.isFree(preferredPort) ? preferredPort : (PortUtil.ephemeralPort() ?? 0)
        guard chosen != 0, let nwPort = NWEndpoint.Port(rawValue: chosen) else {
            throw NSError(domain: "ZMailBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: "No free port"])
        }
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: nwPort)
        params.allowLocalEndpointReuse = true
        let listener = try NWListener(using: params)
        self.listener = listener
        self.port = chosen

        listener.newConnectionHandler = { [weak self] conn in
            self?.accept(conn)
        }

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let resumed = LockedFlag()
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if resumed.setOnce() { cont.resume() }
                case .failed(let error):
                    if resumed.setOnce() { cont.resume(throwing: error) }
                    else { NSLog("[bridge] listener failed: \(error)") }
                default:
                    break
                }
            }
            listener.start(queue: queue)
        }
        return chosen
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        receive(conn, buffer: Data())
        // Hard timeout so a stalled client cannot pin a connection forever.
        queue.asyncAfter(deadline: .now() + 300) { conn.cancel() }
    }

    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { conn.cancel(); return }
            var buffer = buffer
            if let data { buffer.append(data) }
            switch HTTPParser.parse(buffer) {
            case .complete(let request):
                let handler = self.handler
                Task {
                    let response = await handler(request)
                    Self.send(response, on: conn)
                }
            case .invalid(let status):
                Self.send(.error(status, "bad_request"), on: conn)
            case .incomplete:
                if isComplete || error != nil { conn.cancel(); return }
                self.receive(conn, buffer: buffer)
            }
        }
    }

    private static func send(_ response: HTTPResponse, on conn: NWConnection) {
        conn.send(content: response.serialized(), completion: .contentProcessed { _ in
            conn.cancel()
        })
    }
}

/// Thread-safe one-shot flag (used to resume a continuation exactly once).
final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func setOnce() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if value { return false }
        value = true
        return true
    }
}

enum PortUtil {
    /// True when 127.0.0.1:`port` can be bound right now.
    static func isFree(_ port: UInt16) -> Bool {
        withBoundSocket(port) { _ in true } ?? false
    }

    /// Asks the kernel for an unused port on 127.0.0.1.
    static func ephemeralPort() -> UInt16? {
        withBoundSocket(0) { fd in
            var addr = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let ok = withUnsafeMutablePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
            }
            return ok == 0 ? UInt16(bigEndian: addr.sin_port) : nil
        } ?? nil
    }

    /// First free port in [start, start+count).
    static func firstFree(from start: UInt16, count: UInt16 = 100) -> UInt16? {
        for offset in 0..<count where start &+ offset >= start {
            if isFree(start + offset) { return start + offset }
        }
        return ephemeralPort()
    }

    private static func withBoundSocket<T>(_ port: UInt16, _ body: (Int32) -> T) -> T? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        // Match node/NWListener semantics: a port in TIME_WAIT is still usable.
        var one: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let rc = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard rc == 0 else { return nil }
        return body(fd)
    }
}
