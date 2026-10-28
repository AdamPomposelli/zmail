import AVFoundation
import Speech

/// Voice input for the composer's assistant: macOS speech recognition, on the Mac when the
/// language supports it (free, private). Streams partial text, the final text and the input
/// level to the web UI through `onEvent`.
@MainActor
final class Dictation {
    struct Event { var text: String; var final: Bool; var level: Double; var error: String? }

    var onEvent: ((Event) -> Void)?

    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var running = false

    func start(language: String?) {
        guard !running else { return }
        Task {
            guard await Self.authorize() else {
                onEvent?(Event(text: "", final: true, level: 0, error: L10n.tr("Autorisez le micro et la reconnaissance vocale pour ZMail dans Réglages Système → Confidentialité et sécurité.", "Allow the microphone and speech recognition for ZMail in System Settings → Privacy & Security.")))
                return
            }
            begin(language: language)
        }
    }

    func stop() {
        guard running else { return }
        audio.stop()
        audio.inputNode.removeTap(onBus: 0)
        request?.endAudio()
    }

    private func begin(language: String?) {
        let locale = Locale(identifier: language ?? Locale.preferredLanguages.first ?? "fr-FR")
        guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
            onEvent?(Event(text: "", final: true, level: 0, error: "La reconnaissance vocale n’est pas disponible pour cette langue."))
            return
        }
        self.recognizer = recognizer
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request

        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.makeTap(request: request) { [weak self] level in
            Task { @MainActor in self?.sendLevel(level) }
        })
        do {
            audio.prepare()
            try audio.start()
        } catch {
            input.removeTap(onBus: 0)
            onEvent?(Event(text: "", final: true, level: 0, error: "Micro indisponible : \(error.localizedDescription)"))
            return
        }
        running = true
        task = recognizer.recognitionTask(with: request, resultHandler: Self.makeResultHandler { [weak self] text, final, failed in
            Task { @MainActor in
                guard let self else { return }
                if final || failed {
                    self.running = false
                    self.audio.stop()
                    self.audio.inputNode.removeTap(onBus: 0)
                    self.task = nil
                    self.request = nil
                }
                // A cancelled or silent session ends without text: not an error worth showing.
                self.onEvent?(Event(text: text, final: final || failed, level: 0, error: nil))
            }
        })
    }

    private var lastLevelAt = Date.distantPast
    /// About 15 level updates a second: enough for a fluid waveform, light on the web view.
    private func sendLevel(_ level: Double) {
        guard Date().timeIntervalSince(lastLevelAt) > 0.066 else { return }
        lastLevelAt = Date()
        onEvent?(Event(text: "", final: false, level: level, error: nil))
    }

    /// Nonisolated on purpose: macOS answers on a background queue, and a callback written inside
    /// this @MainActor class would be assumed to run on the main thread — Swift 6 traps when it
    /// does not (the crash of 28 October: `dispatch_assert_queue` in `Dictation.authorize()`).
    nonisolated private static func authorize() async -> Bool {
        let speech = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { @Sendable status in continuation.resume(returning: status == .authorized) }
        }
        guard speech else { return false }
        return await AVCaptureDevice.requestAccess(for: .audio)
    }

    /// The microphone tap runs on the audio thread: built outside the main actor, it only hands
    /// the level back to the main thread.
    nonisolated private static func makeTap(request: SFSpeechAudioBufferRecognitionRequest, onLevel: @escaping @Sendable (Double) -> Void) -> AVAudioNodeTapBlock {
        { buffer, _ in
            request.append(buffer)
            onLevel(level(of: buffer))
        }
    }

    /// Speech results arrive on a background queue: same rule as the tap.
    nonisolated private static func makeResultHandler(_ handle: @escaping @Sendable (String, Bool, Bool) -> Void) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, error in
            let final = result?.isFinal ?? false
            handle(result?.bestTranscription.formattedString ?? "", final, error != nil && !final)
        }
    }

    /// Rough input loudness (0…1) for the UI's live waveform.
    nonisolated private static func level(of buffer: AVAudioPCMBuffer) -> Double {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(buffer.frameLength))
        return Double(min(1, max(0, (20 * log10(max(rms, 1e-6)) + 55) / 50)))
    }
}
