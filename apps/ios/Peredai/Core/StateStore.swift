import Foundation

/// Копія стану сайту на телефоні (те саме, що localStorage `teplo.v1` усередині WKWebView). Навіщо: WKWebView може втратити свої дані
/// (переустановка, очищення), а ця копія — у контейнері застосунку (App Group — її побачать і віджети) і в iCloud.
/// Джерело правди — сайт (його логіка злиття TeploSync.merge); застосунок лише зберігає й повертає копію (TeploHost.restore).
@MainActor
final class StateStore {
    static let shared = StateStore()

    private let fileURL: URL
    private(set) var json: String?
    private(set) var at: Date = .distantPast

    private init() {
        let fm = FileManager.default
        let dir = fm.containerURL(forSecurityApplicationGroupIdentifier: AppConfig.appGroup)
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("state.json")
        if let d = try? Data(contentsOf: fileURL), let s = String(data: d, encoding: .utf8) {
            json = s
            let attrs = try? fm.attributesOfItem(atPath: fileURL.path)
            at = (attrs?[.modificationDate] as? Date) ?? .distantPast
        }
    }

    /// Є квартири й показання (не порожній стан нового телефона).
    var hasData: Bool { StateStore.hasData(json) }

    nonisolated static func hasData(_ s: String?) -> Bool {
        guard let s, !s.isEmpty else { return false }
        return s.contains("\"onboarded\":true")
    }

    func save(_ s: String, at t: Date) {
        guard !s.isEmpty else { return }
        json = s
        at = t
        let url = fileURL
        DispatchQueue.global(qos: .utility).async {
            try? Data(s.utf8).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try? FileManager.default.setAttributes([.modificationDate: t], ofItemAtPath: url.path)
        }
    }
}
