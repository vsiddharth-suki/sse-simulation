import Foundation

@MainActor
final class SseClient: ObservableObject {
    enum LinkState: String {
        case closed
        case open
        case silent
        case reconnecting
    }

    let baseURL = "http://127.0.0.1:8080"
    @Published var link: LinkState = .closed
    @Published var lastSeq: String
    @Published var connectionId = ""
    @Published var silenceSeconds = 0
    @Published var logText = ""

    private let sessionConfig: URLSessionConfiguration
    private var streamSession: URLSession?
    private var streamTask: URLSessionDataTask?
    private var tap: StreamTap?
    private var clockTask: Task<Void, Never>?
    private var manual = false
    private var generation = 0
    private var heartbeatMs = 0
    private var watchdog = 0
    private var lastByte = Date.distantPast
    private var silenceLogged = false
    private var carry = ""
    private var eventName = "message"
    private var dataField = ""

    init() {
        lastSeq = UserDefaults.standard.string(forKey: "sse-spike-last-seq") ?? ""
        let config = URLSessionConfiguration.ephemeral
        // Longer than the nginx idle cut, so URLSession does not hide that cut.
        config.timeoutIntervalForRequest = 60 * 60
        config.timeoutIntervalForResource = 24 * 60 * 60
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = false
        sessionConfig = config
        clockTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                self?.tick()
            }
        }
    }

    func connect() {
        manual = true
        generation += 1
        stopStream()
        manual = false
        connectionId = ""
        heartbeatMs = 0
        watchdog = 0
        carry = ""
        eventName = "message"
        dataField = ""
        lastByte = Date()
        silenceLogged = false
        startStream(generation: generation, seq: lastSeq)
    }

    func disconnect() {
        manual = true
        generation += 1
        stopStream()
        link = .closed
        log("disconnected by tester")
    }

    func logScene(_ phase: String) {
        log("scene \(phase)")
    }

    private func startStream(generation gen: Int, seq: String) {
        guard let url = streamURL(seq: seq) else {
            log("bad URL")
            link = .closed
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 60 * 60
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if !seq.isEmpty {
            request.setValue(seq, forHTTPHeaderField: "Last-Event-ID")
        }
        log("URLSession open \(url.absoluteString)" + (seq.isEmpty ? "" : " Last-Event-ID=\(seq)"))
        link = seq.isEmpty ? .open : .reconnecting
        let tap = StreamTap()
        tap.onResponse = { [weak self] http in
            Task { @MainActor in self?.opened(http, generation: gen) }
        }
        tap.onBytes = { [weak self] data in
            Task { @MainActor in self?.consume(data, generation: gen) }
        }
        tap.onDone = { [weak self] error in
            Task { @MainActor in self?.ended(error, generation: gen) }
        }
        self.tap = tap
        let session = URLSession(configuration: sessionConfig, delegate: tap, delegateQueue: nil)
        streamSession = session
        let task = session.dataTask(with: request)
        streamTask = task
        task.resume()
    }

    private func stopStream() {
        streamTask?.cancel()
        streamSession?.invalidateAndCancel()
        streamTask = nil
        streamSession = nil
        tap = nil
    }

    private func opened(_ http: HTTPURLResponse, generation gen: Int) {
        guard gen == generation else { return }
        guard http.statusCode == 200 else {
            log("HTTP \(http.statusCode)")
            link = .closed
            stopStream()
            return
        }
        noteByte()
        link = .open
    }

    private func consume(_ data: Data, generation gen: Int) {
        guard gen == generation else { return }
        noteByte()
        let text = String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        carry += text
        while let newline = carry.firstIndex(of: "\n") {
            let line = String(carry[..<newline])
            carry = String(carry[carry.index(after: newline)...])
            take(line)
        }
    }

    private func take(_ line: String) {
        if line.isEmpty {
            if !dataField.isEmpty { apply(eventName: eventName, data: dataField) }
            eventName = "message"
            dataField = ""
            return
        }
        if line.hasPrefix(":") {
            let comment = line.dropFirst().trimmingCharacters(in: .whitespaces)
            log(comment == "ping" ? "ping" : "comment \(comment)")
            return
        }
        if line.hasPrefix("event:") {
            eventName = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
            dataField += String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
        }
    }

    private func ended(_ error: Error?, generation gen: Int) {
        guard gen == generation else { return }
        if let error, (error as NSError).code == NSURLErrorCancelled { return }
        if let error {
            log("URLSession error \(error.localizedDescription)")
            link = .closed
            return
        }
        guard !manual else {
            link = .closed
            return
        }
        log("URLSession stream ended cleanly")
        link = .reconnecting
        log("reconnecting after clean end")
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            if !manual, gen == generation { self.connect() }
        }
    }

    private func tick() {
        guard link == .open || link == .silent else {
            silenceSeconds = 0
            return
        }
        let age = Date().timeIntervalSince(lastByte)
        silenceSeconds = Int(age)
        if watchdog == 0 {
            let mark = heartbeatMs > 0 ? Double(heartbeatMs) / 1000 : 20
            if age > mark, link == .open {
                link = .silent
                if !silenceLogged {
                    silenceLogged = true
                    log("no bytes for \(silenceSeconds)s; connection still open")
                }
            }
            return
        }
        guard heartbeatMs > 0 else { return }
        if age > Double(watchdog * heartbeatMs) / 1000 {
            log("no ping or status for \(watchdog)×\(heartbeatMs)ms, reconnecting")
            connect()
        }
    }

    private func noteByte() {
        lastByte = Date()
        silenceLogged = false
        if link == .silent || link == .reconnecting { link = .open }
    }

    private func apply(eventName: String, data: String) {
        guard let json = try? JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any] else { return }
        if eventName == "hello" {
            connectionId = json["connectionId"] as? String ?? ""
            if let ms = json["heartbeatMs"] as? NSNumber {
                heartbeatMs = ms.intValue
            }
            if let multiplier = json["watchdog"] as? NSNumber {
                watchdog = multiplier.intValue
            }
            log("connected")
        } else if eventName == "status" {
            if let seq = json["seq"] as? String {
                lastSeq = seq
                UserDefaults.standard.set(seq, forKey: "sse-spike-last-seq")
            }
            log("received \(json["text"] ?? "")")
        }
    }

    private func streamURL(seq: String) -> URL? {
        guard var components = URLComponents(string: baseURL + "/stream") else { return nil }
        var items: [URLQueryItem] = []
        if !seq.isEmpty {
            items.append(URLQueryItem(name: "last_seq", value: seq))
        }
        if !items.isEmpty {
            components.queryItems = items
        }
        return components.url
    }

    private func log(_ message: String) {
        logText += Self.stamp.string(from: Date()) + "  " + message + "\n"
    }

    private static let stamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
        return formatter
    }()
}

private final class StreamTap: NSObject, URLSessionDataDelegate {
    var onResponse: ((HTTPURLResponse) -> Void)?
    var onBytes: ((Data) -> Void)?
    var onDone: ((Error?) -> Void)?

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        if let http = response as? HTTPURLResponse {
            onResponse?(http)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        onBytes?(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        onDone?(error)
    }
}
