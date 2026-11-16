import SwiftUI
import UIKit
import WebKit

/// Один WKWebView на весь застосунок (живий сайт). Нативні вкладки лише перемикають маршрут сайту — інакше два екземпляри сайту
/// писали б той самий localStorage навперебій. Міст: сайт → `window.webkit.messageHandlers.peredai`, застосунок → `window.TeploHost`.
@MainActor
final class WebHost: NSObject {
    static let shared = WebHost()

    let webView: WKWebView
    /// Маршрут сайту, вкладка (home|history|stats|prefs|''), екран вводу (без вкладок), чи вже є квартири.
    var onRoute: ((_ route: SiteRoute) -> Void)?
    var onPopup: ((UIViewController) -> Void)?
    /// 156-а: людина почала друкувати в листі вводу — свайп униз уже питає, а не закриває мовчки.
    var onDirty: ((Bool) -> Void)?
    /// 157-а: строки з сайту — для плашки над вкладками (iOS 26) в останні дні вікна.
    var onSched: ((SchedPayload) -> Void)?

    private(set) var loaded = false
    private var queue: [String] = []
    private var restoreChecked = false
    private let offline = OfflineView()
    /// Без інтернету — остання збережена копія сайту з тією ж адресою (дані localStorage ті самі): показання можна вносити й офлайн.
    private var offlineMode = false
    private var cacheTried = false
    private var cacheFresh = false
    private let cacheURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("site-cache.html")
    }()

    private override init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        // сайт впізнає застосунок за «PeredaiApp/» (і лише тоді вмикає міст і ховає свої нижні вкладки)
        cfg.applicationNameForUserAgent = "Mobile/15E148 PeredaiApp/\(AppConfig.version)"
        cfg.defaultWebpagePreferences.preferredContentMode = .mobile
        let ucc = WKUserContentController()
        // 156-а: що вміє застосунок — сайт читає до свого старту (v3: лист для вводу показань, меню квартири на заголовку)
        // 157-а: v4 — налаштування списком, «+» і меню видів на панелі, свайп і контекстне меню рядків історії
        ucc.addUserScript(Self.nativeScript())
        cfg.userContentController = ucc
        webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        ucc.add(WeakMessageHandler(self), name: "peredai")
        // 160-а: Vision читає текст на фото й кадрах камери (сайт: recognize.js → natRead), відповідь — Promise у сторінці
        ucc.addScriptMessageHandler(NativeOCR.shared, contentWorld: .page, name: NativeOCR.name)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // 157-а: довге натискання на рядок історії — рідне контекстне меню (статус); інші посилання меню не мають (див. contextMenuConfigurationForElement)
        webView.allowsLinkPreview = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "Housing")
        webView.scrollView.backgroundColor = UIColor(named: "Housing")
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        let rc = UIRefreshControl()
        rc.addTarget(self, action: #selector(pullToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = rc
        offline.onRetry = { [weak self] in self?.reload() }
        // 157-а: розмір тексту — за «Розміром тексту» iPhone (Dynamic Type): сайт сам масштабує сторінку й перекладається під вужчу ширину
        // (meta viewport, TeploHost.textZoom). WKWebView.pageZoom на iOS лише збільшував — сторінка вилазила праворуч (скрини CI 157-ї)
        textZoom = Self.zoom(UIApplication.shared.preferredContentSizeCategory)
        _ = NotificationCenter.default.addObserver(forName: UIContentSizeCategory.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyTextSize() }
        }
    }

    /// Dynamic Type → множник сторінки. Більше 1,3 не робимо: ширина сайту стала б менша за 300 точок.
    static func zoom(_ c: UIContentSizeCategory) -> CGFloat {
        switch c {
        case .extraSmall: return 0.88
        case .small: return 0.92
        case .medium: return 0.96
        case .large: return 1.0
        case .extraLarge: return 1.1
        case .extraExtraLarge: return 1.18
        case .extraExtraExtraLarge: return 1.24
        default: return c.isAccessibilityCategory ? 1.3 : 1.0
        }
    }

    private var textZoom: CGFloat = 1

    /// Що вміє застосунок (сайт читає до свого старту) і множник тексту.
    private static func nativeScript() -> WKUserScript {
        let z = zoom(UIApplication.shared.preferredContentSizeCategory)
        return WKUserScript(source: "window.PeredaiNative={v:4,sheet:1,pmenu:1,list:1,add:1,km:1,ctx:1,ocr:1,tz:\(z)};",
                            injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    private func applyTextSize() {
        let z = Self.zoom(UIApplication.shared.preferredContentSizeCategory)
        guard abs(z - textZoom) > 0.001 else { return }
        textZoom = z
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(Self.nativeScript())
        run("window.TeploHost && window.TeploHost.textZoom && window.TeploHost.textZoom(\(z))")
    }

    func start(route: String = "") {
        var route = route
        #if DEBUG
        // CI (скрини в симуляторі): -PeredaiRoute history — відкрити одразу цей екран
        if route.isEmpty, let r = UserDefaults.standard.string(forKey: "PeredaiRoute") { route = r }
        #endif
        var c = URLComponents(url: AppConfig.base, resolvingAgainstBaseURL: false)
        if !route.isEmpty { c?.fragment = route }
        cacheTried = false
        webView.load(URLRequest(url: c?.url ?? AppConfig.base, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 20))
    }

    func reload() {
        offline.removeFromSuperview()
        if webView.url == nil || offlineMode { offlineMode = false; start() } else { webView.reload() }
    }

    /// Свіжа копія сайту для офлайну — раз на запуск, після вдалого завантаження з мережі.
    private func refreshCache() {
        guard !cacheFresh else { return }
        cacheFresh = true
        var req = URLRequest(url: AppConfig.base, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        req.setValue("Mozilla/5.0 (iPhone) Mobile/15E148 PeredaiApp/\(AppConfig.version)", forHTTPHeaderField: "User-Agent")
        let url = cacheURL
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            guard let data, (resp as? HTTPURLResponse)?.statusCode == 200, data.count > 50_000,
                  let html = String(data: data, encoding: .utf8), html.contains("TeploHost") else { return }
            try? data.write(to: url, options: .atomic)
        }.resume()
    }

    /// Немає мережі — відкрити збережену копію сайту (та сама адреса → ті самі дані). true — відкрили.
    private func openCached() -> Bool {
        guard !cacheTried, let d = try? Data(contentsOf: cacheURL), let html = String(data: d, encoding: .utf8) else { return false }
        cacheTried = true
        offlineMode = true
        webView.loadHTMLString(html, baseURL: AppConfig.base)
        return true
    }

    @objc private func pullToRefresh(_ rc: UIRefreshControl) {
        webView.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { rc.endRefreshing() }
    }

    /// Виконати JS на сайті — одразу, якщо сайт завантажений, інакше після завантаження.
    func run(_ js: String) {
        if loaded { webView.evaluateJavaScript(js, completionHandler: nil) } else { queue.append(js) }
    }

    func go(_ route: String) {
        run("window.TeploHost && window.TeploHost.go(\(Self.jsString(route)))")
    }

    /// 155-а: рідна кнопка «Назад» / «Скасувати» на панелі — куди скаже сайт (TeploHost.back).
    func back() { run("window.TeploHost && window.TeploHost.back && window.TeploHost.back()") }

    /// 156-а: права кнопка листа — головна кнопка екрана сайту («Зберегти», «Далі», «Перевірити»).
    func act() { run("window.TeploHost && window.TeploHost.act && window.TeploHost.act()") }

    /// 156-а: «Скасувати» / свайп униз листа — є введене, сайт спитає (як «Скасувати й вийти»), інакше назад, звідки прийшли.
    func cancel() { run("window.TeploHost && window.TeploHost.cancel && window.TeploHost.cancel()") }

    /// 156-а: «Готово» листа передачі.
    func close() { run("window.TeploHost && window.TeploHost.close && window.TeploHost.close()") }

    /// 156-а: меню квартири на заголовку.
    func place(_ id: String) { run("window.TeploHost && window.TeploHost.place && window.TeploHost.place(\(Self.jsString(id)))") }

    /// 157-а: «+» на панелі сторінки лічильника — головна дія сторінки.
    func add() { run("window.TeploHost && window.TeploHost.add && window.TeploHost.add()") }

    /// 157-а: вид з меню на панелі «Історії» / «Статистики».
    func view(_ k: String) { run("window.TeploHost && window.TeploHost.view && window.TeploHost.view(\(Self.jsString(k)))") }

    /// 157-а: пункт контекстного меню рядка історії (статус).
    func rowAct(_ frag: String, _ id: String) {
        run("window.TeploHost && window.TeploHost.rowAct && window.TeploHost.rowAct(\(Self.jsString(frag)), \(Self.jsString(id)))")
    }

    /// 155-а: «Відгук» — кнопкою на панелі «Налаштувань» (плаваючу кнопку сайту застосунок ховає).
    func feedback() { run("window.TeploHost && window.TeploHost.feedback && window.TeploHost.feedback()") }

    /// Нагадування / Live Activity / віджет: квартира й вид.
    func open(g: String, place: String) {
        run("window.TeploHost && window.TeploHost.open(\(Self.jsString(g)), \(Self.jsString(place)))")
    }

    /// Застосунок знову на екрані — оновити строки (нова доба могла відкрити вікно) і Live Activity; був офлайн — спробувати мережу.
    func resumed() {
        if offlineMode { offlineMode = false; start(); return }
        run("window.TeploHost && window.TeploHost.sched()")
    }

    func openUniversal(_ url: URL) {
        guard url.host == AppConfig.base.host else { return }
        webView.load(URLRequest(url: url))
    }

    static func jsString(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
        let arr = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }

    // MARK: — повідомлення сайту

    fileprivate func handle(_ body: Any) {
        guard let m = body as? [String: Any], let t = m["t"] as? String else { return }
        switch t {
        case "route":
            onRoute?(SiteRoute(m))
            if !restoreChecked {
                restoreChecked = true
                let on = m["on"] as? Bool ?? false
                Task { await self.restoreIfNeeded(webHasData: on) }
            }
        case "sched":
            guard let d = try? JSONSerialization.data(withJSONObject: m),
                  let p = try? JSONDecoder().decode(SchedPayload.self, from: d) else { return }
            WidgetFeed.save(p)
            onSched?(p)
            QuickActions.install()   // мова сайту могла змінитись — підписи швидких дій теж
            Task {
                await Reminders.schedule(p)
                await LiveWindow.update(p)
            }
        case "state":
            guard let s = m["s"] as? String, !s.isEmpty else { return }
            let ms = m["at"] as? Double ?? Date().timeIntervalSince1970 * 1000
            let at = Date(timeIntervalSince1970: ms / 1000)
            StateStore.shared.save(s, at: at)
            CloudBackup.shared.scheduleUpload(json: s, at: at)
        case "dirty":
            onDirty?(m["on"] as? Bool ?? false)
        case "haptic":
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "apple":
            AppleSignIn.shared.start()
        default:
            break
        }
    }

    /// Перший маршрут сайту: сайт порожній (новий телефон, очищені дані WebView) — повертаємо копію (телефон, потім iCloud);
    /// дані є, а в iCloud новіша копія з іншого пристрою — зливаємо (TeploSync.merge на сайті).
    private func restoreIfNeeded(webHasData: Bool) async {
        #if DEBUG
        // CI: -PeredaiDemo <файл> — демо-стан (tests/e2e/demo.cjs) і згода на cookie, лише в порожній застосунок
        if !webHasData, let path = UserDefaults.standard.string(forKey: "PeredaiDemo"), let demo = try? String(contentsOfFile: path, encoding: .utf8) {
            run("try{localStorage.setItem('teplo.cc',JSON.stringify({v:1,a:0,at:new Date().toISOString(),id:'ci'}))}catch(e){}; window.TeploHost && window.TeploHost.restore(\(Self.jsString(demo)))")
            return
        }
        #endif
        let local = StateStore.shared
        var best: (json: String, at: Date)? = local.hasData ? (local.json ?? "", local.at) : nil
        if let cloud = await CloudBackup.shared.fetch(), StateStore.hasData(cloud.json), cloud.at > (best?.at ?? .distantPast) {
            best = cloud
        }
        guard let b = best, !b.json.isEmpty else { return }
        if webHasData && b.at <= local.at { return }
        run("window.TeploHost && window.TeploHost.restore(\(Self.jsString(b.json)))")
    }
}

// MARK: — навігація: свій сайт — усередині, решта (банки, Telegram, телефон, пошта) — системою

extension WebHost: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "about" || scheme == "blob" || scheme == "data" { return decisionHandler(.allow) }
        if scheme == "http" || scheme == "https" {
            if url.host == AppConfig.base.host || action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
            // Вхід через Telegram — віконце oauth.telegram.org усередині (popup), інші сайти — у Safari / застосунку банку
            if url.host?.hasSuffix("telegram.org") == true && webView !== self.webView { return decisionHandler(.allow) }
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        loaded = true
        offline.removeFromSuperview()
        if !offlineMode { refreshCache() }
        let q = queue
        queue.removeAll()
        for js in q { webView.evaluateJavaScript(js, completionHandler: nil) }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView === self.webView { loaded = false }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === self.webView { showOffline(error) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === self.webView { showOffline(error) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func showOffline(_ error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if openCached() { return }
        guard offline.superview == nil, let host = webView.superview else { return }
        offline.frame = host.bounds
        offline.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(offline)
    }
}

// MARK: — віконця (вхід через Telegram), камера, alert/confirm сайту

extension WebHost: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        // target=_blank на чужий сайт — системою; віконце входу Telegram (window.open з opener) — усередині, щоб відповідь дійшла сайту
        if url.host != AppConfig.base.host && url.host?.hasSuffix("telegram.org") != true && url.absoluteString != "about:blank" {
            UIApplication.shared.open(url)
            return nil
        }
        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        let vc = PopupController(web: popup)
        onPopup?(vc)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView !== self.webView { webView.window?.rootViewController?.presentedViewController?.dismiss(animated: true) }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        // камеру дозволяє сама iOS (NSCameraUsageDescription) — сайт не питає вдруге
        decisionHandler(origin.host == AppConfig.base.host ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: L10n.ok, style: .default) { _ in completionHandler() })
        present(a, or: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: L10n.cancel, style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: L10n.ok, style: .default) { _ in completionHandler(true) })
        present(a) { completionHandler(false) }
    }

    /// 157-а (крок 4 плану навігації iOS, як у «Пошті»): довге натискання на рядок історії — рідне контекстне меню зі статусами запису
    /// (ті самі варіанти, що в чипі рядка; тексти — сайту). Решта посилань — без меню (nil).
    func webView(_ webView: WKWebView, contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo,
                 completionHandler: @escaping @MainActor @Sendable (UIContextMenuConfiguration?) -> Void) {
        guard webView === self.webView, let url = elementInfo.linkURL, url.host == AppConfig.base.host || url.host == nil,
              let frag = url.fragment, frag.range(of: "^(rec|wrec|erec)-", options: .regularExpression) != nil else {
            return completionHandler(nil)
        }
        let js = "window.TeploHost && window.TeploHost.rowMenu ? window.TeploHost.rowMenu(\(Self.jsString(frag))) : ''"
        webView.evaluateJavaScript(js) { [weak self] res, _ in
            guard let self, let str = res as? String, let data = str.data(using: .utf8),
                  let m = try? JSONDecoder().decode(RowMenu.self, from: data), !m.items.isEmpty else { return completionHandler(nil) }
            let acts: [UIMenuElement] = m.items.map { it in
                UIAction(title: it.t, subtitle: (it.s ?? "").isEmpty ? nil : it.s, state: it.on == true ? .on : .off) { [weak self] _ in
                    UISelectionFeedbackGenerator().selectionChanged()
                    self?.rowAct(frag, it.id)
                }
            }
            let menu = UIMenu(title: m.title ?? "", children: acts)
            completionHandler(UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { _ in menu })
        }
    }

    /// Дотик до піднятого рядка — відкрити запис.
    func webView(_ webView: WKWebView, contextMenuForElement elementInfo: WKContextMenuElementInfo,
                 willCommitWithAnimator animator: any UIContextMenuInteractionCommitAnimating) {
        guard let frag = elementInfo.linkURL?.fragment else { return }
        animator.addCompletion { MainActor.assumeIsolated { WebHost.shared.go(frag) } }
    }

    private func present(_ vc: UIViewController, or fallback: @escaping () -> Void) {
        guard let root = webView.window?.rootViewController else { return fallback() }
        var top = root
        while let p = top.presentedViewController { top = p }
        top.present(vc, animated: true)
    }
}

/// 157-а: меню рядка історії від сайту (TeploHost.rowMenu): {title, items: [{id, t, s, on}]}.
struct RowMenu: Decodable {
    struct Item: Decodable { let id: String; let t: String; let s: String?; let on: Bool? }
    let title: String?
    let items: [Item]
}

/// WKUserContentController тримає обробник сильно — через проміжний обʼєкт, щоб не було циклу.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var host: WebHost?
    init(_ host: WebHost) { self.host = host }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { host?.handle(message.body) }
    }
}

/// Віконце сайту (вхід через Telegram) — аркушем знизу з кнопкою «Закрити».
final class PopupController: UIViewController {
    let web: WKWebView
    init(web: WKWebView) {
        self.web = web
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let bar = UINavigationBar()
        let item = UINavigationItem(title: "")
        item.rightBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
        bar.setItems([item], animated: false)
        bar.translatesAutoresizingMaskIntoConstraints = false
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        view.addSubview(web)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: bar.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }
}

/// Немає звʼязку: що дані на телефоні цілі, і «Спробувати ще».
final class OfflineView: UIView {
    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(named: "Housing") ?? .systemBackground
        let icon = UIImageView(image: UIImage(systemName: "wifi.slash"))
        icon.tintColor = .secondaryLabel
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 40, weight: .regular)
        let title = UILabel()
        title.text = L10n.offlineTitle
        title.font = .preferredFont(forTextStyle: .title3)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0
        let text = UILabel()
        text.text = L10n.offlineText
        text.font = .preferredFont(forTextStyle: .body)
        text.adjustsFontForContentSizeCategory = true
        text.textColor = .secondaryLabel
        text.textAlignment = .center
        text.numberOfLines = 0
        var bc = UIButton.Configuration.filled()
        bc.title = L10n.retry
        bc.cornerStyle = .large
        bc.baseBackgroundColor = UIColor(named: "AccentColor")
        bc.baseForegroundColor = .systemBackground
        let button = UIButton(configuration: bc, primaryAction: UIAction { [weak self] _ in self?.onRetry?() })
        let stack = UIStackView(arrangedSubviews: [icon, title, text, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.setCustomSpacing(24, after: text)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: layoutMarginsGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: layoutMarginsGuide.trailingAnchor, constant: -16),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

/// 155-а: що сайт сказав про екран — вкладка, екран вводу, назва для рідної панелі, куди «Назад» ('' — корінь вкладки).
/// 156-а: лист (sheet) для вводу й передачі показань — ліва кнопка (lb: cancel | back), права (rb — підпис, rbk: act | close), чи є введене;
/// квартира — назва під заголовком (sub) і меню на ньому (places, тексти pmAll / pmAdd).
struct SiteRoute {
    struct Place { let id: String; let name: String; let on: Bool }
    let route: String
    let tab: String
    let bare: Bool
    let title: String
    let up: String
    let cancel: String
    let back: String
    let sheet: Bool
    let lb: String
    let rb: String
    let rbk: String
    let dirty: Bool
    let sub: String
    let places: [Place]
    let pmAll: String
    let pmAdd: String
    let pmLbl: String
    /// 157-а: «+» на панелі (підпис для VoiceOver; '' — немає), види історії / статистики для меню на панелі (> 4).
    struct Kind { let k: String; let name: String; let on: Bool }
    let add: String
    let kinds: [Kind]
    let kindsLbl: String

    init(_ m: [String: Any]) {
        func s(_ k: String) -> String { m[k] as? String ?? "" }
        route = s("r"); tab = s("tab"); bare = m["bare"] as? Bool ?? false
        title = s("title"); up = s("up"); cancel = s("cancel"); back = s("back")
        sheet = m["sheet"] as? Bool ?? false
        lb = s("lb"); rb = s("rb"); rbk = s("rbk"); dirty = m["dirty"] as? Bool ?? false; sub = s("sub")
        places = (m["pl"] as? [[String: Any]] ?? []).compactMap { p in
            guard let id = p["id"] as? String, let n = p["n"] as? String else { return nil }
            return Place(id: id, name: n, on: p["on"] as? Bool ?? false)
        }
        let pm = m["pm"] as? [String: Any] ?? [:]
        pmAll = pm["all"] as? String ?? ""; pmAdd = pm["add"] as? String ?? ""; pmLbl = pm["lbl"] as? String ?? ""
        add = s("add"); kindsLbl = s("kml")
        kinds = (m["km"] as? [[String: Any]] ?? []).compactMap { x in
            guard let k = x["k"] as? String, let n = x["n"] as? String else { return nil }
            return Kind(k: k, name: n, on: x["on"] as? Bool ?? false)
        }
    }
}
