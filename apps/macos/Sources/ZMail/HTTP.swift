import Foundation

/// Minimal HTTP/1.1 request model for the native bridge. Only Content-Length
/// bodies are supported (no chunked transfer encoding, no keep-alive).
struct HTTPRequest: Sendable {
    var method: String
    var path: String
    var query: [String: String]
    var headers: [String: String] // lower-cased names
    var body: Data

    func header(_ name: String) -> String? { headers[name.lowercased()] }

    /// Parses the body as a JSON object. Returns nil for an empty or non-object body.
    func jsonObject() -> [String: Any]? {
        guard !body.isEmpty else { return nil }
        return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }
}

struct HTTPResponse: Sendable {
    var status: Int
    var headers: [String: String] = [:]
    var body: Data = Data()

    static func json(_ status: Int, _ object: [String: Any]) -> HTTPResponse {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
        return HTTPResponse(status: status, headers: ["Content-Type": "application/json; charset=utf-8"], body: data)
    }

    static func error(_ status: Int, _ code: String, reason: String? = nil) -> HTTPResponse {
        var obj: [String: Any] = ["error": code]
        if let reason { obj["reason"] = reason }
        return json(status, obj)
    }

    func serialized() -> Data {
        var head = "HTTP/1.1 \(status) \(HTTPResponse.reasonPhrase(status))\r\n"
        var all = headers
        all["Content-Length"] = String(body.count)
        all["Connection"] = "close"
        all["Cache-Control"] = all["Cache-Control"] ?? "no-store"
        for (k, v) in all.sorted(by: { $0.key < $1.key }) { head += "\(k): \(v)\r\n" }
        head += "\r\n"
        var out = Data(head.utf8)
        out.append(body)
        return out
    }

    static func reasonPhrase(_ status: Int) -> String {
        switch status {
        case 200: "OK"
        case 204: "No Content"
        case 400: "Bad Request"
        case 401: "Unauthorized"
        case 404: "Not Found"
        case 405: "Method Not Allowed"
        case 413: "Payload Too Large"
        case 422: "Unprocessable Entity"
        case 500: "Internal Server Error"
        case 503: "Service Unavailable"
        default: "Status"
        }
    }
}

enum HTTPParseResult {
    case incomplete
    case complete(HTTPRequest)
    case invalid(Int) // HTTP status to reply with
}

enum HTTPParser {
    static let maxHeaderBytes = 32 * 1024
    static let maxBodyBytes = 4 * 1024 * 1024

    /// Attempts to parse a full request out of `buffer`.
    static func parse(_ buffer: Data) -> HTTPParseResult {
        let separator = Data("\r\n\r\n".utf8)
        guard let headerEnd = buffer.range(of: separator) else {
            return buffer.count > maxHeaderBytes ? .invalid(413) : .incomplete
        }
        guard let headText = String(data: buffer[buffer.startIndex..<headerEnd.lowerBound], encoding: .utf8) else {
            return .invalid(400)
        }
        var lines = headText.components(separatedBy: "\r\n")
        guard !lines.isEmpty else { return .invalid(400) }
        let requestLine = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: true)
        guard requestLine.count >= 2 else { return .invalid(400) }

        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true { return .invalid(400) }

        let length = Int(headers["content-length"] ?? "0") ?? -1
        guard length >= 0 else { return .invalid(400) }
        guard length <= maxBodyBytes else { return .invalid(413) }
        let bodyStart = headerEnd.upperBound
        guard buffer.count - (bodyStart - buffer.startIndex) >= length else { return .incomplete }
        let body = buffer.subdata(in: bodyStart..<(bodyStart + length))

        let target = String(requestLine[1])
        let comps = URLComponents(string: target)
        var query: [String: String] = [:]
        for item in comps?.queryItems ?? [] { query[item.name] = item.value ?? "" }
        let path = comps?.path.isEmpty == false ? comps!.path : target

        return .complete(HTTPRequest(method: String(requestLine[0]).uppercased(), path: path,
                                     query: query, headers: headers, body: body))
    }
}
