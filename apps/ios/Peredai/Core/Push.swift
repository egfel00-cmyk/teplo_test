import ActivityKit
import Foundation
import UIKit
import UserNotifications

/// 186-а (iOS етап 2): токени пушів — сайту в застосунку (TeploHost.pushToken), а він — на сервер, коли людина ввійшла.
/// apns — звичайні уведомлення (підсумки відправки у фоні: ХТМ, Водоканал, місцеві КП);
/// las — push-to-start Live Activity (iOS 17.2+): сервер запускає «вікно передачі» за 4 дні до кінця строку, навіть коли застосунок закритий.
/// Без ключа APNs на сервері (/admin → «Пуші iPhone») токени просто лежать — нічого не надсилається.
@MainActor
enum Push {
    /// Debug-збірка (Xcode, симулятор) — пісочниця APNs; TestFlight і App Store — бойовий.
    static var env: String {
        #if DEBUG
        return "sandbox"
        #else
        return "prod"
        #endif
    }

    private static var watching = false

    /// На кожному запуску: дозвіл на уведомлення вже є — взяти токен (iOS дає той самий або новий); і стежити за токеном Live Activity.
    static func start() {
        Task {
            let st = await UNUserNotificationCenter.current().notificationSettings()
            if allowed(st.authorizationStatus) { UIApplication.shared.registerForRemoteNotifications() }
        }
        guard !watching else { return }
        watching = true
        if #available(iOS 17.2, *) {
            Task {
                for await data in Activity<WindowActivityAttributes>.pushToStartTokenUpdates {
                    send(hex(data), kind: "las")
                }
            }
        }
    }

    /// Людина щойно дозволила уведомлення (Reminders.schedule) — одразу по токен.
    static func allowedNow() { UIApplication.shared.registerForRemoteNotifications() }

    static func allowed(_ s: UNAuthorizationStatus) -> Bool {
        s == .authorized || s == .provisional || s == .ephemeral
    }

    static func registered(_ token: Data) { send(hex(token), kind: "apns") }

    static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

    private static func send(_ tok: String, kind: String) {
        NSLog("[peredai] push token \(kind) (\(tok.count / 2) bytes)")
        WebHost.shared.run("window.TeploHost && window.TeploHost.pushToken && window.TeploHost.pushToken(\(WebHost.jsString(tok)), \(WebHost.jsString(kind)), \(WebHost.jsString(env)))")
    }
}
