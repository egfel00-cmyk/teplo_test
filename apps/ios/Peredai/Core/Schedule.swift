import ActivityKit
import Foundation
import UserNotifications
import WidgetKit

/// Строки з сайту (міст `sched`): кожна квартира × вид — до коли, чи вже передано. Тексти — теж із сайту (uk/ru).
struct SchedItem: Decodable {
    let p: String
    let pn: String
    let k: String
    let kt: String
    let due: String
    let done: Bool
    let pay: Bool
    let go: String
}

struct SchedText: Decodable {
    let title: String
    let body: String
    let pay: String
    let la: String
    let la_go: String
    let la_done: String
    // віджети (сайт до 154-ї їх не слав — тоді українською за замовчуванням)
    var w_title: String?
    var w_left: String?
    var w_today: String?
    var w_done: String?
    var w_empty: String?
    // 157-а: плашка над вкладками (iOS 26) — «Внести» / «Сплатити»
    var acc_go: String?
    var acc_pay: String?
}

struct SchedPayload: Decodable {
    let items: [SchedItem]
    let today: String
    let soon: Int
    let txt: SchedText
}

/// Строки для віджетів: файл у спільній папці App Group (її бачить розширення), потім — перемалювати віджети.
@MainActor
enum WidgetFeed {
    static func save(_ p: SchedPayload) {
        let items: [WidgetDeadline] = p.items.compactMap { it in
            guard let due = Day.parse(it.due) else { return it.done ? WidgetDeadline(kind: it.k, title: it.kt, place: it.pn, placeId: it.p, due: nil, done: true, pay: it.pay, route: it.go) : nil }
            return WidgetDeadline(kind: it.k, title: it.kt, place: it.pn, placeId: it.p, due: due, done: it.done, pay: it.pay, route: it.go)
        }
        let t = p.txt
        let feed = WidgetSnapshot(items: items, at: Date(), title: t.w_title ?? "Строки", left: t.w_left ?? "ще {n} дн.",
                                  today: t.w_today ?? "сьогодні", done: t.w_done ?? "Усе передано", empty: t.w_empty ?? "Відкрийте застосунок")
        WidgetSnapshot.write(feed)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Нагадування за `soon` (4) дні до кінця вікна, о 10:00 — одне на квартиру й вид, лише поки не передано (власник: «ненавʼязливо, за 4 дні»).
/// Працюють без інтернету й без акаунта: розклад — на телефоні.
@MainActor
enum Reminders {
    static let prefix = "win."

    static func schedule(_ p: SchedPayload) async {
        let c = UNUserNotificationCenter.current()
        let old = await c.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        c.removePendingNotificationRequests(withIdentifiers: old)
        let open = p.items.filter { !$0.done && !$0.due.isEmpty }
        guard !open.isEmpty else { return }
        // дозвіл — у контексті: коли вже є що нагадувати, а не на першому запуску
        let st = await c.notificationSettings()
        #if DEBUG
        if UserDefaults.standard.string(forKey: "PeredaiDemo") != nil { return }   // CI: без системного запиту поверх скрина
        #endif
        if st.authorizationStatus == .notDetermined {
            _ = try? await c.requestAuthorization(options: [.alert, .sound, .badge])
        }
        let cal = Calendar.current
        let now = Date()
        for it in open {
            guard let due = Day.parse(it.due), let day = cal.date(byAdding: .day, value: -p.soon, to: due) else { continue }
            var comps = cal.dateComponents([.year, .month, .day], from: day)
            comps.hour = 10
            comps.minute = 0
            guard let fire = cal.date(from: comps), fire > now else { continue }
            let content = UNMutableNotificationContent()
            if it.pay {
                content.title = fill(p.txt.pay, it, due)
            } else {
                content.title = p.txt.title
                content.body = fill(p.txt.body, it, due)
            }
            content.sound = .default
            content.threadIdentifier = "win"
            content.userInfo = ["g": it.go, "p": it.p]
            let req = UNNotificationRequest(identifier: "\(prefix)\(it.p).\(it.k).\(it.due)", content: content,
                                            trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false))
            try? await c.add(req)
        }
    }

    static func fill(_ tpl: String, _ it: SchedItem, _ due: Date) -> String {
        tpl.replacingOccurrences(of: "{k}", with: it.kt)
            .replacingOccurrences(of: "{p}", with: it.pn)
            .replacingOccurrences(of: "{d}", with: DueText.long(due))
    }
}

/// Live Activity (Dynamic Island і заблокований екран) — останні `soon` днів вікна, поки є непередане.
/// iOS дозволяє запускати її лише з відкритого застосунку і тримає до 8 год — тому оновлюємо на кожному відкритті;
/// для людей з акаунтом сервер зможе запускати її сам (push-to-start, APNs) — наступний крок.
@MainActor
enum LiveWindow {
    static func update(_ p: SchedPayload) async {
        let cal = Calendar.current
        // «сьогодні» сайту (те саме, що бачить людина на картках; у демо — підставна дата)
        let today = Day.parse(p.today) ?? cal.startOfDay(for: Date())
        var soon = p.soon
        #if DEBUG
        // CI (скрини): -PeredaiSoon 31 — показати Live Activity, навіть коли до кінця вікна більше 4 днів
        let ds = UserDefaults.standard.integer(forKey: "PeredaiSoon")
        if ds > 0 { soon = ds }
        #endif
        let items: [WindowItem] = p.items.compactMap { it in
            guard let due = Day.parse(it.due) else { return nil }
            let left = cal.dateComponents([.day], from: today, to: due).day ?? 99
            guard left >= 0, left <= soon else { return nil }
            return WindowItem(id: "\(it.p)|\(it.k)", kind: it.k, title: it.kt, place: it.pn, placeId: it.p, due: due,
                              done: it.done, pay: it.pay, route: it.go)
        }
        .sorted { a, b in a.done != b.done ? !a.done : a.due < b.due }
        let open = items.filter { !$0.done }
        NSLog("[peredai] Live Activity: \(items.count) of \(p.items.count) in last \(soon) days, \(open.count) open")
        let running = Activity<WindowActivityAttributes>.activities
        guard !open.isEmpty else {
            for a in running { await a.end(nil, dismissalPolicy: .immediate) }
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { NSLog("[peredai] Live Activity: disabled"); return }
        let last = open.map(\.due).max() ?? today
        let stale = cal.date(byAdding: .day, value: 1, to: last)
        let content = ActivityContent(state: WindowActivityAttributes.ContentState(items: Array(items.prefix(6)), updatedAt: Date()),
                                      staleDate: stale)
        if let a = running.first {
            await a.update(content)
            for extra in running.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
        } else {
            let attrs = WindowActivityAttributes(title: p.txt.la, goLabel: p.txt.la_go, doneLabel: p.txt.la_done)
            do {
                _ = try Activity.request(attributes: attrs, content: content, pushType: nil)
            } catch {
                NSLog("[peredai] Live Activity: \(error.localizedDescription)")
            }
        }
    }
}
