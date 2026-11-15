import Foundation

/// Строки передачі для віджетів — те саме, що бачить застосунок (міст `sched` із сайту), записане в спільну папку App Group.
struct WidgetDeadline: Codable, Hashable, Identifiable {
    var id: String { "\(placeId)|\(kind)" }
    var kind: String
    var title: String
    var place: String
    var placeId: String
    /// nil — передано, а наступного вікна ще не знаємо
    var due: Date?
    var done: Bool
    var pay: Bool
    var route: String

    var url: URL {
        var c = URLComponents()
        c.scheme = "peredai"
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "g", value: route), URLQueryItem(name: "p", value: placeId)]
        return c.url ?? URL(string: "peredai://open")!
    }
}

struct WidgetSnapshot: Codable {
    var items: [WidgetDeadline]
    var at: Date
    /// Тексти з сайту (uk/ru): «Строки», «ще {n} дн.», «сьогодні», «Усе передано», «Відкрийте застосунок…».
    var title: String
    var left: String
    var today: String
    var done: String
    var empty: String

    static let appGroup = "group.ua.com.peredai"

    private static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("widget.json")
    }

    static func write(_ s: WidgetSnapshot) {
        guard let url, let d = try? JSONEncoder().encode(s) else { return }
        try? d.write(to: url, options: .atomic)
    }

    static func read() -> WidgetSnapshot? {
        guard let url, let d = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: d)
    }

    /// Непередані зі строком — від найближчого.
    var open: [WidgetDeadline] {
        items.filter { !$0.done && $0.due != nil }.sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }
    }

    /// «ще 3 дн.» / «сьогодні» на дату `now`.
    func leftText(_ due: Date, now: Date) -> String {
        let cal = Calendar.current
        let n = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: due)).day ?? 0
        return n <= 0 ? today : left.replacingOccurrences(of: "{n}", with: String(n))
    }
}
