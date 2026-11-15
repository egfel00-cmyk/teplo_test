import SwiftUI
import WidgetKit

/// Віджет «Строки»: що й до коли передати — на домашньому екрані й на екрані блокування.
/// Дані — копія строків із сайту (WidgetSnapshot у App Group); дні до строку перераховуються щоночі без застосунку.
struct DeadlinesEntry: TimelineEntry {
    let date: Date
    let snap: WidgetSnapshot?
}

struct DeadlinesProvider: TimelineProvider {
    func placeholder(in context: Context) -> DeadlinesEntry { DeadlinesEntry(date: Date(), snap: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (DeadlinesEntry) -> Void) {
        completion(DeadlinesEntry(date: Date(), snap: WidgetSnapshot.read() ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DeadlinesEntry>) -> Void) {
        let snap = WidgetSnapshot.read()
        let cal = Calendar.current
        let now = Date()
        var dates = [now]
        for d in 1...7 {
            if let m = cal.date(byAdding: .day, value: d, to: cal.startOfDay(for: now)) { dates.append(m) }
        }
        completion(Timeline(entries: dates.map { DeadlinesEntry(date: $0, snap: snap) }, policy: .atEnd))
    }
}

struct DeadlinesView: View {
    @Environment(\.widgetFamily) private var family
    let entry: DeadlinesEntry

    var body: some View {
        let snap = entry.snap
        let open = snap?.open ?? []
        switch family {
        case .accessoryInline:
            if let f = open.first, let due = f.due {
                Label("\(f.title) · \(DueText.short(due))", systemImage: MeterKind.symbol(f.kind))
            } else {
                Label(snap?.done ?? "передай", systemImage: "checkmark.circle")
            }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                if let f = open.first, let due = f.due {
                    VStack(spacing: 0) {
                        Image(systemName: MeterKind.symbol(f.kind)).font(.system(size: 13, weight: .semibold))
                        Text(DueText.short(due)).font(.system(size: 12, weight: .semibold)).monospacedDigit()
                    }
                } else {
                    Image(systemName: "checkmark").font(.system(size: 18, weight: .semibold))
                }
            }
            .widgetURL(open.first?.url)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                if let s = snap, let f = open.first, let due = f.due {
                    Label(f.title, systemImage: MeterKind.symbol(f.kind)).font(.headline).lineLimit(1)
                    Text("\(DueText.short(due)) · \(s.leftText(due, now: entry.date))").font(.subheadline).monospacedDigit().lineLimit(1)
                    Text(f.place).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                } else {
                    Label(snap?.title ?? "передай", systemImage: "calendar").font(.headline)
                    Text(snap == nil ? (WidgetSnapshot.sample.empty) : (snap?.done ?? "")).font(.caption).lineLimit(2)
                }
            }
            .widgetURL(open.first?.url)
        case .systemMedium:
            VStack(alignment: .leading, spacing: 8) {
                Text(snap?.title ?? "передай").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if let s = snap, !open.isEmpty {
                    ForEach(open.prefix(3)) { it in
                        Link(destination: it.url) {
                            HStack(spacing: 10) {
                                KindBadge(kind: it.kind, size: 26)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(it.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Text(it.place).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer(minLength: 6)
                                if let due = it.due {
                                    VStack(alignment: .trailing, spacing: 0) {
                                        Text(DueText.short(due)).font(.subheadline.weight(.semibold)).monospacedDigit()
                                        Text(s.leftText(due, now: entry.date)).font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                } else {
                    EmptyDeadlines(snap: snap)
                }
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                if let s = snap, let f = open.first, let due = f.due {
                    KindBadge(kind: f.kind, size: 30)
                    Spacer(minLength: 0)
                    Text(f.title).font(.headline).lineLimit(1)
                    Text(f.place).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(DueText.short(due)).font(.title3.weight(.semibold)).monospacedDigit()
                        Text(s.leftText(due, now: entry.date)).font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    EmptyDeadlines(snap: snap)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(open.first?.url)
        }
    }
}

struct EmptyDeadlines: View {
    let snap: WidgetSnapshot?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: snap == nil ? "calendar" : "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(snap == nil ? Color.secondary : Color.green)
            Text(snap == nil ? WidgetSnapshot.sample.empty : (snap?.done ?? ""))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct DeadlinesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ua.com.peredai.deadlines", provider: DeadlinesProvider()) { entry in
            DeadlinesView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("передай")
        .description(AppLang.ru ? "Что и до какого числа передать." : "Що й до якого числа передати.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

enum AppLang {
    static var ru: Bool { (Locale.preferredLanguages.first ?? "uk").hasPrefix("ru") }
}

extension WidgetSnapshot {
    /// Для галереї віджетів (до першого запуску застосунку).
    static var sample: WidgetSnapshot {
        let cal = Calendar.current
        let d1 = cal.date(byAdding: .day, value: 2, to: cal.startOfDay(for: Date())) ?? Date()
        let d2 = cal.date(byAdding: .day, value: 9, to: cal.startOfDay(for: Date())) ?? Date()
        let ru = AppLang.ru
        return WidgetSnapshot(items: [
            WidgetDeadline(kind: "elec", title: ru ? "Свет" : "Світло", place: ru ? "Моя квартира" : "Моя квартира", placeId: "main", due: d1, done: false, pay: false, route: "elec"),
            WidgetDeadline(kind: "cold", title: ru ? "Холодная вода" : "Холодна вода", place: ru ? "Моя квартира" : "Моя квартира", placeId: "main", due: d2, done: false, pay: false, route: "water-cold"),
        ], at: Date(), title: ru ? "Сроки" : "Строки", left: ru ? "ещё {n} дн." : "ще {n} дн.", today: ru ? "сегодня" : "сьогодні",
           done: ru ? "Всё передано" : "Усе передано", empty: ru ? "Откройте приложение, чтобы увидеть сроки" : "Відкрийте застосунок, щоб побачити строки")
    }
}
