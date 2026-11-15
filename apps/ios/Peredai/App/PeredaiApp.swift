import SwiftUI
import UIKit
import UserNotifications

@main
struct PeredaiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .ignoresSafeArea()
                .onOpenURL { url in Links.open(url) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { act in
                    if let url = act.webpageURL { Links.open(url) }
                }
        }
        .onChange(of: phase) { _, p in
            switch p {
            case .active:
                WebHost.shared.resumed()
            case .background:
                Task { await CloudBackup.shared.flush() }
            default:
                break
            }
        }
    }
}

/// peredai://open?g=elec&p=main (Live Activity, нагадування, віджет) і https://peredai.com.ua/… (універсальні посилання з Telegram, пошти).
@MainActor
enum Links {
    static func open(_ url: URL) {
        if url.scheme == "peredai" {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let g = q.first(where: { $0.name == "g" })?.value ?? "home"
            let p = q.first(where: { $0.name == "p" })?.value ?? ""
            WebHost.shared.open(g: g, place: p)
        } else {
            WebHost.shared.openUniversal(url)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ app: UIApplication, didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// Нагадування, коли застосунок відкритий, — банером (сайт і так покаже строк на картці).
    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    /// Натиснули нагадування — на лічильник потрібної квартири.
    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse) async {
        let info = r.notification.request.content.userInfo
        let g = info["g"] as? String ?? "home"
        let p = info["p"] as? String ?? ""
        await MainActor.run { WebHost.shared.open(g: g, place: p) }
    }
}
