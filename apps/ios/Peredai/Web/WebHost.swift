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
    var onRoute: ((_ route: String, _ tab: String, _ bare: Bool) -> Void)?
    var onPopup: ((UIViewController) -> Void)?

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
        cfg.userContentController = ucc
        webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        ucc.add(WeakMessageHandler(self), name: "peredai")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
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
    }

    func start(route: String = "") {
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
            let r = m["r"] as? String ?? ""
            let tab = m["tab"] as? String ?? ""
            let bare = m["bare"] as? Bool ?? false
            onRoute?(r, tab, bare)
            if !restoreChecked {
                restoreChecked = true
                let on = m["on"] as? Bool ?? false
                Task { await self.restoreIfNeeded(webHasData: on) }
            }
        case "sched":
            guard let d = try? JSONSerialization.data(withJSONObject: m),
                  let p = try? JSONDecoder().decode(SchedPayload.self, from: d) else { return }
            WidgetFeed.save(p)
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

    private func present(_ vc: UIViewController, or fallback: @escaping () -> Void) {
        guard let root = webView.window?.rootViewController else { return fallback() }
        var top = root
        while let p = top.presentedViewController { top = p }
        top.present(vc, animated: true)
    }
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
