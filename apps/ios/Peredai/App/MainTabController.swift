import SwiftUI
import UIKit
import WebKit

/// Нативні вкладки (UITabBar — у iOS 26 «рідке скло» системи) над одним живим сайтом: Квартири · Історія · Статистика · Налаштування,
/// як нижні вкладки сайту (їх сайт у застосунку ховає). Перемикання вкладки = маршрут сайту; сайт сам каже, яка вкладка його
/// (свайп «назад», посилання всередині), а на екранах вводу (майстри, внесення показань) вкладки ховаються — як на сайті.
/// 156-а (крок 3 плану навігації): ввід і передача показань — листом знизу (той самий WKWebView переїжджає в лист),
/// квартира — назвою під заголовком і меню на ньому.
final class MainTabController: UITabBarController, UITabBarControllerDelegate, UIAdaptivePresentationControllerDelegate {
    private struct Tab { let route: String; let title: String; let symbol: String }
    private let defs: [Tab] = [
        Tab(route: "home", title: L10n.tabHome, symbol: "house"),
        Tab(route: "history", title: L10n.tabHistory, symbol: "list.bullet.rectangle"),
        Tab(route: "stats", title: L10n.tabStats, symbol: "chart.bar"),
        Tab(route: "prefs", title: L10n.tabPrefs, symbol: "slider.horizontal.3"),
    ]
    private var host: WebHost { WebHost.shared }
    private var started = false
    /// Лист вводу показань (поки відкритий, сайт — у ньому) і знімок сторінки під ним у вкладці.
    private var sheet: SheetController?
    private var placeholder: UIView?

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
        host.onDirty = { [weak self] on in self?.sheet?.isModalInPresentation = on }
        attachWeb(to: rootVC(0)?.view)
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
        attachWeb(to: rootVC(i)?.view)
        UISelectionFeedbackGenerator().selectionChanged()
        host.go(defs[i].route)
    }

    /// Сайт перейшов сам (посилання, «назад», нагадування) — підсвітити його вкладку, на екранах вводу сховати вкладки,
    /// на панелі — назва екрана і «‹» / «Скасувати» (куди — вирішує сайт: TeploHost.back).
    private func siteRoute(_ r: SiteRoute) {
        if r.sheet {
            openSheet()
            if let s = sheet { configureSheet(s, r) }
            return
        }
        closeSheet()
        if let i = defs.firstIndex(where: { $0.route == r.tab }), i != selectedIndex {
            selectedIndex = i
        }
        attachWeb(to: rootVC(selectedIndex)?.view)
        dropPlaceholder()
        setBarHidden(r.bare)
        guard let item = rootVC(selectedIndex)?.navigationItem else { return }
        item.title = r.title.isEmpty ? defs[selectedIndex].title : r.title
        item.titleView = titleView(r, title: item.title ?? "")
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

    // MARK: — 156-а: квартира в заголовку

    /// Квартира — назва під заголовком; дві й більше квартир з цим видом — меню на заголовку (як «Фото» й «Файли»):
    /// квартири (поточна з галочкою), «Усі квартири», «Додати квартиру». Квартира одна — звичайний заголовок.
    private func titleView(_ r: SiteRoute, title: String) -> UIView? {
        guard !r.sub.isEmpty else { return nil }
        var menu: UIMenu?
        if r.places.count > 1 {
            let ps = r.places.map { p in
                UIAction(title: p.name, state: p.on ? .on : .off) { [weak self] _ in
                    if !p.on { UISelectionFeedbackGenerator().selectionChanged(); self?.host.place(p.id) }
                }
            }
            var more: [UIMenuElement] = []
            if !r.pmAll.isEmpty { more.append(UIAction(title: r.pmAll, image: UIImage(systemName: "square.grid.2x2")) { [weak self] _ in self?.host.go("home") }) }
            if !r.pmAdd.isEmpty { more.append(UIAction(title: r.pmAdd, image: UIImage(systemName: "plus")) { [weak self] _ in self?.host.go("add-place") }) }
            menu = UIMenu(title: r.pmLbl, children: [UIMenu(options: .displayInline, children: ps), UIMenu(options: .displayInline, children: more)])
        }
        return TitleButton.make(title: title, sub: r.sub, menu: menu)
    }

    // MARK: — 156-а: лист вводу показань

    private func openSheet() {
        guard sheet == nil else { return }
        let tabRoot = rootVC(selectedIndex)?.view
        // під листом — знімок сторінки, з якої відкрили (сам сайт переїжджає в лист)
        if let root = tabRoot, placeholder == nil, let snap = host.webView.snapshotView(afterScreenUpdates: false) {
            snap.frame = host.webView.frame
            snap.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            root.addSubview(snap)
            placeholder = snap
        }
        let s = SheetController()
        s.presentationController?.delegate = self
        sheet = s
        attachWeb(to: s.content.view)
        setBarHidden(false)
        presentTop(s)
    }

    private func configureSheet(_ s: SheetController, _ r: SiteRoute) {
        let item = s.content.navigationItem
        item.title = r.title
        item.titleView = r.sub.isEmpty ? nil : TitleButton.make(title: r.title, sub: r.sub, menu: nil)
        switch r.lb {
        case "back":
            let b = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), primaryAction: UIAction { [weak self] _ in self?.host.back() })
            b.accessibilityLabel = r.back.isEmpty ? L10n.back : r.back
            item.leftBarButtonItem = b
        default:
            item.leftBarButtonItem = UIBarButtonItem(title: r.cancel.isEmpty ? L10n.cancel : r.cancel, primaryAction: UIAction { [weak self] _ in self?.host.cancel() })
        }
        if r.rb.isEmpty {
            item.rightBarButtonItem = nil
        } else {
            let close = r.rbk == "close"
            let b = UIBarButtonItem(title: r.rb, primaryAction: UIAction { [weak self] _ in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                if close { self?.host.close() } else { self?.host.act() }
            })
            b.style = .done
            #if compiler(>=6.2)
            if #available(iOS 26.0, *) { b.style = .prominent }   // iOS 26: головна дія панелі — заповнена кнопка (HIG)
            #endif
            item.rightBarButtonItem = b
        }
        s.isModalInPresentation = r.dirty
    }

    /// Сайт пішов з екрана вводу (зберегли, скасували) — лист з’їжджає зі знімком, сайт уже під ним у вкладці.
    private func closeSheet() {
        guard let s = sheet else { return }
        sheet = nil
        if let snap = host.webView.snapshotView(afterScreenUpdates: false) {
            snap.frame = host.webView.frame
            s.content.view.addSubview(snap)
        }
        s.dismiss(animated: true)
    }

    /// Свайп униз без введеного — лист уже закрито: сайт — назад у вкладку (під знімком, поки сайт не перейде), і «Скасувати».
    func presentationControllerDidDismiss(_ pc: UIPresentationController) {
        guard let s = sheet, pc.presentedViewController === s else { return }
        sheet = nil
        attachWeb(to: rootVC(selectedIndex)?.view)
        if let p = placeholder { p.superview?.bringSubviewToFront(p) }
        host.cancel()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in if self?.sheet == nil { self?.dropPlaceholder() } }
    }

    /// Свайп униз, а в листі вже є цифри — питає сайт (те саме питання, що «Скасувати й вийти»).
    func presentationControllerDidAttemptToDismiss(_ pc: UIPresentationController) {
        host.cancel()
    }

    private func dropPlaceholder() {
        placeholder?.removeFromSuperview()
        placeholder = nil
    }

    // MARK: —

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

    /// Один WKWebView переїжджає у вибрану вкладку чи в лист (стан сайту — той самий).
    private func attachWeb(to target: UIView?) {
        guard let target else { return }
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
        while let p = top.presentedViewController, !p.isBeingDismissed { top = p }
        top.present(vc, animated: true)
    }
}

/// 156-а: лист знизу для вводу й передачі показань — своя панель навігації («Скасувати» / «‹» зліва, головна кнопка справа),
/// смужка-ручка, свайп униз = «Скасувати».
final class SheetController: UINavigationController {
    let content = UIViewController()

    init() {
        super.init(rootViewController: content)
        modalPresentationStyle = .pageSheet
        content.view.backgroundColor = UIColor(named: "Housing")
        content.navigationItem.largeTitleDisplayMode = .never
        view.backgroundColor = UIColor(named: "Housing")
        if let sp = sheetPresentationController {
            sp.detents = [.large()]
            sp.prefersGrabberVisible = true
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

/// 156-а: заголовок з назвою квартири під ним; з меню — шеврон ⌄ і вибір квартири одним дотиком (pull-down, як у «Фото» і «Файлах»).
enum TitleButton {
    static func make(title: String, sub: String, menu: UIMenu?) -> UIButton {
        var c = UIButton.Configuration.plain()
        var ta = AttributeContainer()
        ta.uiKit.font = UIFont.preferredFont(forTextStyle: .headline)
        ta.uiKit.foregroundColor = UIColor.label
        c.attributedTitle = AttributedString(title, attributes: ta)
        var sa = AttributeContainer()
        sa.uiKit.font = UIFont.preferredFont(forTextStyle: .caption1)
        sa.uiKit.foregroundColor = UIColor.secondaryLabel
        c.attributedSubtitle = AttributedString(sub, attributes: sa)
        c.titleAlignment = .center
        c.titleLineBreakMode = .byTruncatingTail
        c.subtitleLineBreakMode = .byTruncatingTail
        c.contentInsets = NSDirectionalEdgeInsets(top: 2, leading: 4, bottom: 2, trailing: 4)
        if menu != nil {
            c.image = UIImage(systemName: "chevron.down.circle.fill",
                              withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold))
            c.imagePlacement = .trailing
            c.imagePadding = 6
            c.baseForegroundColor = .secondaryLabel
        }
        let b = UIButton(configuration: c)
        b.accessibilityLabel = title + ", " + sub
        if let menu {
            b.menu = menu
            b.showsMenuAsPrimaryAction = true
        } else {
            b.isUserInteractionEnabled = false
            b.accessibilityTraits = .header
        }
        return b
    }
}

/// SwiftUI ↔ UIKit: корінь застосунку.
struct RootView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> MainTabController { MainTabController() }
    func updateUIViewController(_ vc: MainTabController, context: Context) {}
}
