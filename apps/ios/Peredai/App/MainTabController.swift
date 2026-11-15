import SwiftUI
import UIKit
import WebKit

/// Нативні вкладки (UITabBar — у iOS 26 «рідке скло» системи) над одним живим сайтом: Квартири · Історія · Статистика · Налаштування,
/// як нижні вкладки сайту (їх сайт у застосунку ховає). Перемикання вкладки = маршрут сайту; сайт сам каже, яка вкладка його
/// (свайп «назад», посилання всередині), а на екранах вводу (майстри, внесення показань) вкладки ховаються — як на сайті.
final class MainTabController: UITabBarController, UITabBarControllerDelegate {
    private struct Tab { let route: String; let title: String; let symbol: String }
    private let defs: [Tab] = [
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
        // 155-а (розбір навігації за HIG): у кожної вкладки — рідна панель навігації: назва екрана від сайту, «‹» або «Скасувати» зліва.
        // Логотип сайту в застосунку схований (html.in-app), тож «де я» і «куди назад» — там, де їх шукають на iPhone.
        viewControllers = defs.enumerated().map { i, t in
            let vc = UIViewController()
            vc.view.backgroundColor = UIColor(named: "Housing")
            vc.navigationItem.title = t.title
            vc.navigationItem.largeTitleDisplayMode = .never
            if t.route == "prefs" { vc.navigationItem.rightBarButtonItem = feedbackItem() }
            let nav = UINavigationController(rootViewController: vc)
            nav.navigationBar.prefersLargeTitles = false
            nav.tabBarItem = UITabBarItem(title: t.title, image: UIImage(systemName: t.symbol), tag: i)
            return nav
        }
        host.onRoute = { [weak self] r in self?.siteRoute(r) }
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
        host.go(defs[i].route)
    }

    /// Сайт перейшов сам (посилання, «назад», нагадування) — підсвітити його вкладку, на екранах вводу сховати вкладки,
    /// на панелі — назва екрана і «‹» / «Скасувати» (куди — вирішує сайт: TeploHost.back).
    private func siteRoute(_ r: SiteRoute) {
        if let i = defs.firstIndex(where: { $0.route == r.tab }), i != selectedIndex {
            selectedIndex = i
            attachWeb(to: i)
        }
        setBarHidden(r.bare)
        guard let item = rootVC(selectedIndex)?.navigationItem else { return }
        item.title = r.title.isEmpty ? defs[selectedIndex].title : r.title
        if r.up.isEmpty {
            item.leftBarButtonItem = nil
        } else if r.bare {
            let b = UIBarButtonItem(title: r.cancel.isEmpty ? L10n.cancel : r.cancel, primaryAction: UIAction { [weak self] _ in self?.host.back() })
            item.leftBarButtonItem = b
        } else {
            let b = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), primaryAction: UIAction { [weak self] _ in self?.host.back() })
            b.accessibilityLabel = r.back.isEmpty ? L10n.back : r.back
            item.leftBarButtonItem = b
        }
        // «Відгук» — лише на корені «Налаштувань»
        if defs[selectedIndex].route == "prefs" { item.rightBarButtonItem = r.up.isEmpty ? feedbackItem() : nil }
    }

    private func feedbackItem() -> UIBarButtonItem {
        let b = UIBarButtonItem(image: UIImage(systemName: "bubble.left"), primaryAction: UIAction { [weak self] _ in self?.host.feedback() })
        b.accessibilityLabel = L10n.feedback
        return b
    }

    private func rootVC(_ i: Int) -> UIViewController? {
        guard let vcs = viewControllers, i < vcs.count else { return nil }
        return (vcs[i] as? UINavigationController)?.viewControllers.first ?? vcs[i]
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
        guard let target = rootVC(i)?.view else { return }
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
