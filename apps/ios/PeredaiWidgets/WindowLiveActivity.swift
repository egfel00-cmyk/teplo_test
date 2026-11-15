import ActivityKit
import SwiftUI
import WidgetKit

/// Dynamic Island і заблокований екран: «вікно передачі відкрите — світло до 03.11».
/// Компактно: значок виду зліва, дата строку справа. Розгорнуто: що, де, до коли, смужка, що спливає до кінця вікна, і кнопка «Зняти показання».
struct WindowLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WindowActivityAttributes.self) { context in
            LockScreenWindowView(attributes: context.attributes, state: context.state)
                .widgetURL(context.state.items.first(where: { !$0.done })?.url)
        } dynamicIsland: { context in
            let first = context.state.items.first(where: { !$0.done }) ?? context.state.items.first
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    if let f = first {
                        KindBadge(kind: f.kind, size: 36)
                            .padding(.leading, 4)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let f = first {
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(DueText.short(f.due))
                                .font(.title3.weight(.semibold))
                                .monospacedDigit()
                            Text(context.attributes.title)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    if let f = first {
                        VStack(spacing: 2) {
                            Text(f.title).font(.headline).lineLimit(1)
                            Text(f.place).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let f = first {
                        VStack(spacing: 8) {
                            WindowProgress(due: f.due, tint: MeterKind.color(f.kind))
                            let rest = context.state.items.filter { !$0.done && $0.id != f.id }
                            if !rest.isEmpty {
                                Text(rest.prefix(3).map { "\($0.title) · \(DueText.short($0.due))" }.joined(separator: "   "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Link(destination: f.url) {
                                Label(context.attributes.goLabel, systemImage: "camera.viewfinder")
                                    .font(.subheadline.weight(.semibold))
                                    .frame(maxWidth: .infinity, minHeight: 36)
                                    .background(.white.opacity(0.14), in: Capsule())
                            }
                        }
                    }
                }
            } compactLeading: {
                if let f = first {
                    Image(systemName: MeterKind.symbol(f.kind))
                        .foregroundStyle(MeterKind.color(f.kind))
                }
            } compactTrailing: {
                if let f = first {
                    Text(DueText.short(f.due))
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                }
            } minimal: {
                if let f = first {
                    Image(systemName: MeterKind.symbol(f.kind))
                        .foregroundStyle(MeterKind.color(f.kind))
                }
            }
            .keylineTint(first.map { MeterKind.color($0.kind) } ?? .accentColor)
            .widgetURL(first?.url)
        }
    }
}

/// Значок виду в кружку кольору виду.
struct KindBadge: View {
    let kind: String
    var size: CGFloat = 32

    var body: some View {
        Image(systemName: MeterKind.symbol(kind))
            .font(.system(size: size * 0.48, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(MeterKind.color(kind), in: Circle())
    }
}

/// Смужка: скільки лишилось від 4 днів до кінця вікна; спливає сама (ProgressView з timerInterval оновлює система, без нашого коду).
struct WindowProgress: View {
    let due: Date
    let tint: Color

    var body: some View {
        let end = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: due)) ?? due
        let start = Calendar.current.date(byAdding: .day, value: -4, to: end) ?? end
        if start < end {
            ProgressView(timerInterval: start...end, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .tint(tint)
        }
    }
}

struct LockScreenWindowView: View {
    let attributes: WindowActivityAttributes
    let state: WindowActivityAttributes.ContentState

    var body: some View {
        let open = state.items.filter { !$0.done }
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "calendar.badge.clock")
                    .foregroundStyle(.secondary)
                Text(attributes.title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if let f = open.first {
                    Text(DueText.long(f.due))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(open.prefix(3)) { it in
                Link(destination: it.url) {
                    HStack(spacing: 10) {
                        KindBadge(kind: it.kind, size: 28)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(it.place).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Text(DueText.short(it.due))
                            .font(.subheadline.weight(.semibold))
                            .monospacedDigit()
                    }
                }
            }
            if let f = open.first {
                WindowProgress(due: f.due, tint: MeterKind.color(f.kind))
            }
        }
        .padding(16)
    }
}

@main
struct PeredaiWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WindowLiveActivity()
    }
}
