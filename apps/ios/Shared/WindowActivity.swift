import ActivityKit
import Foundation
import SwiftUI

/// Live Activity «вікно передачі показань відкрите» — на заблокованому екрані й у Dynamic Island.
/// Дані — ті самі строки, що на картках головної сайту (placeStatus → міст `sched`): застосунок їх не вигадує.
struct WindowActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Що треба передати/сплатити найближчими днями; перший — найближчий строк.
        var items: [WindowItem]
        var updatedAt: Date
    }

    /// «Відкрите вікно передачі» (uk/ru — з сайту).
    var title: String
    /// «Зняти показання».
    var goLabel: String
    /// «Передано».
    var doneLabel: String
}

struct WindowItem: Codable, Hashable, Identifiable {
    /// квартира|вид
    var id: String
    /// elec, hot, cold, gas, heat, waste
    var kind: String
    /// «Світло», «Холодна вода ×2»
    var title: String
    /// «Моя квартира», «Мамина»
    var place: String
    var placeId: String
    /// Останній день вікна (00:00 наступного дня — кінець).
    var due: Date
    var done: Bool
    /// Оплата (вивіз сміття), а не показання.
    var pay: Bool
    /// Маршрут сайту для кнопки (elec, gas, heat, water-cold…).
    var route: String

    /// peredai://open?g=<маршрут>&p=<квартира> — відкриває застосунок на потрібному лічильнику.
    var url: URL {
        var c = URLComponents()
        c.scheme = "peredai"
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "g", value: route), URLQueryItem(name: "p", value: placeId)]
        return c.url ?? URL(string: "peredai://open")!
    }
}

/// Вид лічильника → значок SF Symbols і колір (як на сайті: світло — жовте, вода — синя/червона, газ — помаранчевий).
enum MeterKind {
    static func symbol(_ k: String) -> String {
        switch k {
        case "elec": return "bolt.fill"
        case "hot", "cold": return "drop.fill"
        case "gas": return "flame.fill"
        case "heat": return "thermometer.medium"
        case "waste": return "trash.fill"
        default: return "gauge.with.dots.needle.33percent"
        }
    }

    static func color(_ k: String) -> Color {
        switch k {
        case "elec": return Color(red: 0.96, green: 0.72, blue: 0.10)
        case "hot": return Color(red: 0.89, green: 0.33, blue: 0.27)
        case "cold": return Color(red: 0.23, green: 0.52, blue: 0.93)
        case "gas": return Color(red: 0.95, green: 0.52, blue: 0.16)
        case "heat": return Color(red: 0.86, green: 0.30, blue: 0.20)
        case "waste": return Color(red: 0.42, green: 0.55, blue: 0.47)
        default: return .secondary
        }
    }
}

enum DueText {
    /// «20.11» — коротко для Dynamic Island.
    static func short(_ d: Date) -> String {
        d.formatted(.dateTime.day(.twoDigits).month(.twoDigits))
    }

    /// «20 листопада» — мовою телефона.
    static func long(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.wide))
    }
}
