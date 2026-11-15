import SwiftUI
import UIKit
import WebKit

/// Нативні вкладки (UITabBar — у iOS 26 «рідке скло» системи) над одним живим сайтом: Квартири · Історія · Статистика · Налаштування,
/// як нижні вкладки сайту (їх сайт у застосунку ховає). Перемикання вкладки = маршрут сайту; сайт сам каже, яка вкладка його
/// (свайп «назад», посилання всередині), а на екранах вводу (майстри, внесення показань) вкладки ховаються — як на сайті.
final class MainTabController: UITabBarController, UITabBarControllerDelegate {
    private struct Tab { let route: String; let title: String; let symbol: String }
    private let tabs: [Tab] = [
        Tab(route: "home", title: L10n.tabHome, symbol: "house"),
        Tab(route: "history", title: L10n.tabHistory, symbol: "list.bullet.rectangle"),
        Tab(route: "stats", title: L10n.tabStats, symbol: "chart.bar"),
        Tab(route: "prefs", title: L10n.tabPrefs, symbol: "slider.horizontal.3"),
    ]
    private var host: WebHost { WebHost.shared }
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        view.backgroundColor = UIColor(named: "Housing")
        viewControllers = tabs.enumerated().map { i, t in
            let vc = UIViewController()
            vc.view.backgroundColor = UIColor(named: "Housing")
            vc.tabBarItem = UITabBarItem(title: t.title, image: UIImage(systemName: t.symbol), tag: i)
            return vc
        }
        host.onRoute = { [weak self] route, tab, bare in self?.siteRoute(route: route, tab: tab, bare: bare) }
        host.onPopup = { [weak self] vc in self?.presentTop(vc) }
        attachWeb(to: 0)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !started {
            started = true
            host.start()
        }
    }

    func tabBarController(_ tbc: UITabBarController, didSelect vc: UIViewController) {
        guard let i = viewControllers?.firstIndex(of: vc) else { return }
        attachWeb(to: i)
        UISelectionFeedbackGenerator().selectionChanged()
        host.go(tabs[i].route)
    }

    /// Сайт перейшов сам (посилання, «назад», нагадування) — підсвітити його вкладку, на екранах вводу сховати вкладки.
    private func siteRoute(route: String, tab: String, bare: Bool) {
        if let i = tabs.firstIndex(where: { $0.route == tab }), i != selectedIndex {
            selectedIndex = i
            attachWeb(to: i)
        }
        setBarHidden(bare)
    }

    private func setBarHidden(_ hidden: Bool) {
        if #available(iOS 18.0, *) {
            if isTabBarHidden != hidden { setTabBarHidden(hidden, animated: true) }
        } else if tabBar.isHidden != hidden {
            tabBar.isHidden = hidden
        }
    }

    /// Один WKWebView переїжджає у вибрану вкладку (стан сайту — той самий).
    private func attachWeb(to i: Int) {
        guard let vcs = viewControllers, i < vcs.count else { return }
        let target = vcs[i].view!
        let web = host.webView
        if web.superview === target { return }
        web.removeFromSuperview()
        web.translatesAutoresizingMaskIntoConstraints = false
        target.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: target.safeAreaLayoutGuide.topAnchor),
            web.leadingAnchor.constraint(equalTo: target.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: target.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: target.safeAreaLayoutGuide.bottomAnchor),
        ])
    }

    private func presentTop(_ vc: UIViewController) {
        var top: UIViewController = self
        while let p = top.presentedViewController { top = p }
        top.present(vc, animated: true)
    }
}

/// SwiftUI ↔ UIKit: корінь застосунку.
struct RootView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> MainTabController { MainTabController() }
    func updateUIViewController(_ vc: MainTabController, context: Context) {}
}
