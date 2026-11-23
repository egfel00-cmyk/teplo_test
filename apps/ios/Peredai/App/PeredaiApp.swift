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
                // кілька секунд фону, щоб останні зміни встигли в iCloud
                let bg = UIApplication.shared.beginBackgroundTask(withName: "icloud-flush", expirationHandler: nil)
                Task {
                    await CloudBackup.shared.flush()
                    UIApplication.shared.endBackgroundTask(bg)
                }
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
        QuickActions.install()
        Task { @MainActor in Push.start() }   // 186-а: токени пушів (уведомлення й Live Activity з сервера)
        #if DEBUG
        if let p = UserDefaults.standard.string(forKey: "PeredaiOcrTest") { NativeOCR.selfTest(path: p) }   // CI: Vision на картинці → log.txt
        #endif
        return true
    }

    /// Дотик до швидкої дії на значку застосунку приходить у делегат сцени — свій клас поруч із SwiftUI-вікном.
    func application(_ app: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: nil, sessionRole: session.role)
        c.delegateClass = QuickSceneDelegate.self
        return c
    }

    /// 186-а: токен APNs — через сайт на сервер (TeploHost.pushToken).
    func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        Task { @MainActor in Push.registered(token) }
    }

    func application(_ app: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[peredai] push: \(error.localizedDescription)")   // симулятор без підпису / немає aps-environment — живемо без пушів
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

/// Швидкі дії на значку (довге натискання на іконку): сфотографувати лічильник, історія, статистика — те, що на вебі не зробиш.
/// Підписи — мовою сайту (AppConfig.lang), оновлюються, коли сайт надсилає строки (sched).
@MainActor
enum QuickActions {
    static func install() {
        UIApplication.shared.shortcutItems = [
            item("photo", L10n.t("Сфотографувати лічильник", "Сфотографировать счётчик"), "camera"),
            item("history", L10n.tabHistory, "list.bullet.rectangle"),
            item("stats", L10n.tabStats, "chart.bar"),
        ]
    }
    private static func item(_ route: String, _ title: String, _ symbol: String) -> UIApplicationShortcutItem {
        UIApplicationShortcutItem(type: "ua.com.peredai.app.\(route)", localizedTitle: title, localizedSubtitle: nil,
                                  icon: UIApplicationShortcutIcon(systemImageName: symbol), userInfo: nil)
    }
    static func handle(_ item: UIApplicationShortcutItem) {
        let route = item.type.components(separatedBy: ".").last ?? "home"
        WebHost.shared.open(g: route, place: "")
    }
}

final class QuickSceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let item = options.shortcutItem else { return }
        Task { @MainActor in QuickActions.handle(item) }   // застосунок запускається з дії — сторінка ще вантажиться, WebHost дочекається
    }
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
        await MainActor.run { QuickActions.handle(shortcutItem) }
        return true
    }
}
