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
        host.onSched = { [weak self] p in self?.updateAccessory(p) }
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
        // праворуч: «Відгук» — лише на корені «Налаштувань»; 157-а — «+» сторінки лічильника, меню видів «Історії» / «Статистики» (> 4 видів)
        var right: [UIBarButtonItem] = []
        if defs[selectedIndex].route == "prefs" && r.up.isEmpty { right.append(feedbackItem()) }
        if !r.add.isEmpty { right.append(addItem(r.add)) }
        if !r.kinds.isEmpty { right.append(kindsItem(r)) }
        item.rightBarButtonItems = right
    }

    // MARK: — 157-а: «+» і меню видів на панелі

    /// Головна дія сторінки лічильника («Внести показання», «Сплатити вивіз») — «+» праворуч на панелі (HIG: одна кнопка в заголовку).
    private func addItem(_ label: String) -> UIBarButtonItem {
        let b = UIBarButtonItem(systemItem: .add, primaryAction: UIAction { [weak self] _ in
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self?.host.add()
        })
        b.accessibilityLabel = label
        return b
    }

    /// Види історії / статистики, коли їх більше 4: pull-down «Світло ⌄» (поточний — з галочкою), як фільтр у «Пошті».
    private func kindsItem(_ r: SiteRoute) -> UIBarButtonItem {
        let acts = r.kinds.map { k in
            UIAction(title: k.name, image: UIImage(systemName: MeterKind.symbol(k.k)), state: k.on ? .on : .off) { [weak self] _ in
                if !k.on { UISelectionFeedbackGenerator().selectionChanged(); self?.host.view(k.k) }
            }
        }
        let cur = r.kinds.first(where: { $0.on })?.name ?? r.kindsLbl
        var c = UIButton.Configuration.plain()
        var ta = AttributeContainer()
        ta.uiKit.font = UIFont.preferredFont(forTextStyle: .body)
        c.attributedTitle = AttributedString(cur, attributes: ta)
        c.image = UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold))
        c.imagePlacement = .trailing
        c.imagePadding = 4
        c.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8)
        let btn = UIButton(configuration: c)
        btn.menu = UIMenu(title: r.kindsLbl, children: acts)
        btn.showsMenuAsPrimaryAction = true
        btn.accessibilityLabel = r.kindsLbl + ": " + cur
        return UIBarButtonItem(customView: btn)
    }

    // MARK: — 157-а: плашка над вкладками (iOS 26, як міні-плеєр «Музики») — в останні дні вікна

    private var accessoryKey = ""

    /// Найближчий непереданий строк у межах `soon` (4) днів — «Світло — до 3 грудня · Внести»; дотик — на лічильник. Немає — плашки немає.
    /// Та сама умова, що в Live Activity й нагадуваннях (строки — з сайту, застосунок їх не вигадує).
    private func updateAccessory(_ p: SchedPayload) {
        #if compiler(>=6.2)
        guard #available(iOS 26.0, *) else { return }
        let cal = Calendar.current
        let today = Day.parse(p.today) ?? cal.startOfDay(for: Date())
        var soon = p.soon
        #if DEBUG
        let ds = UserDefaults.standard.integer(forKey: "PeredaiSoon")
        if ds > 0 { soon = ds }
        #endif
        let open = p.items.compactMap { it -> (SchedItem, Date)? in
            guard !it.done, let due = Day.parse(it.due) else { return nil }
            let left = cal.dateComponents([.day], from: today, to: due).day ?? 99
            return left >= 0 && left <= soon ? (it, due) : nil
        }.sorted { $0.1 < $1.1 }
        guard let first = open.first else {
            if !accessoryKey.isEmpty { accessoryKey = ""; bottomAccessory = nil }
            return
        }
        let it = first.0, due = first.1
        let places = Set(p.items.map(\.p)).count
        let tpl = places > 1 ? p.txt.body : p.txt.body.replacingOccurrences(of: " · {p}", with: "")
        let text = Reminders.fill(tpl, it, due)
        let go = it.pay ? (p.txt.acc_pay ?? L10n.t("Сплатити", "Оплатить")) : (p.txt.acc_go ?? L10n.t("Внести", "Внести"))
        let key = [it.k, it.p, it.due, text, go].joined(separator: "|")
        guard key != accessoryKey else { return }
        accessoryKey = key
        let v = WindowAccessoryView(kind: it.k, text: text, go: go)
        let route = it.go, place = it.p
        v.onTap = { [weak self] in
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self?.host.open(g: route, place: place)
        }
        bottomAccessory = UITabAccessory(contentView: v)
        #endif
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

/// 157-а: вміст плашки над вкладками — значок виду, «Світло — до 3 грудня», праворуч «Внести». Уся плашка — одна кнопка.
final class WindowAccessoryView: UIControl {
    var onTap: (() -> Void)?

    init(kind: String, text: String, go: String) {
        super.init(frame: .zero)
        let icon = UIImageView(image: UIImage(systemName: MeterKind.symbol(kind)))
        icon.tintColor = UIColor(MeterKind.color(kind))
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body)
        icon.setContentHuggingPriority(.required, for: .horizontal)
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.adjustsFontForContentSizeCategory = true
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let action = UILabel()
        action.text = go
        action.font = UIFont.preferredFont(forTextStyle: .subheadline).withTraits(.traitBold)
        action.adjustsFontForContentSizeCategory = true
        action.textColor = UIColor(named: "AccentColor") ?? .systemBlue
        action.setContentHuggingPriority(.required, for: .horizontal)
        action.setContentCompressionResistancePriority(.required, for: .horizontal)
        let stack = UIStackView(arrangedSubviews: [icon, label, action])
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 10
        stack.isUserInteractionEnabled = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityLabel = text
        accessibilityHint = go
        addTarget(self, action: #selector(tapped), for: .touchUpInside)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    @objc private func tapped() { onTap?() }

    override var isHighlighted: Bool { didSet { alpha = isHighlighted ? 0.6 : 1 } }
}

private extension UIFont {
    func withTraits(_ t: UIFontDescriptor.SymbolicTraits) -> UIFont {
        guard let d = fontDescriptor.withSymbolicTraits(t) else { return self }
        return UIFont(descriptor: d, size: 0)
    }
}

/// SwiftUI ↔ UIKit: корінь застосунку.
struct RootView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> MainTabController { MainTabController() }
    func updateUIViewController(_ vc: MainTabController, context: Context) {}
}
