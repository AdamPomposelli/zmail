// Benchmark helper: runs Apple Intelligence (FoundationModels) exactly like ZMail.app's
// bridge does (AIService.generate), without the app. One JSON request per stdin line,
// one JSON reply per stdout line: {"id","system","prompt","temperature","maxTokens"} →
// {"id","text"|"error","ms"}. Requests run concurrently, two at a time like the app.
import Foundation
import FoundationModels

struct Request: Decodable { let id: Int; let system: String?; let prompt: String; let temperature: Double?; let maxTokens: Int? }
struct Reply: Encodable { let id: Int; let text: String?; let error: String?; let ms: Int }

actor Gate {
  var inFlight = 0
  var waiters: [CheckedContinuation<Void, Never>] = []
  func acquire() async {
    if inFlight < 2 { inFlight += 1; return }
    await withCheckedContinuation { waiters.append($0) }
  }
  func release() { if waiters.isEmpty { inFlight -= 1 } else { waiters.removeFirst().resume() } }
}

let out = FileHandle.standardOutput
let lock = NSLock()
func emit(_ reply: Reply) {
  let data = try! JSONEncoder().encode(reply) + Data("\n".utf8)
  lock.lock(); out.write(data); lock.unlock()
}

guard case .available = SystemLanguageModel.default.availability else {
  FileHandle.standardError.write(Data("Apple Intelligence unavailable: \(SystemLanguageModel.default.availability)\n".utf8))
  exit(2)
}

let gate = Gate()
let group = DispatchGroup()
while let line = readLine() {
  guard let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)) else { continue }
  group.enter()
  Task {
    await gate.acquire()
    let started = Date()
    let session = (request.system?.isEmpty == false) ? LanguageModelSession(instructions: request.system!) : LanguageModelSession()
    do {
      let response = try await session.respond(to: request.prompt, options: GenerationOptions(temperature: request.temperature, maximumResponseTokens: request.maxTokens))
      emit(Reply(id: request.id, text: response.content, error: nil, ms: Int(Date().timeIntervalSince(started) * 1000)))
    } catch {
      emit(Reply(id: request.id, text: nil, error: "\(error)", ms: Int(Date().timeIntervalSince(started) * 1000)))
    }
    await gate.release()
    group.leave()
  }
}
group.wait()
