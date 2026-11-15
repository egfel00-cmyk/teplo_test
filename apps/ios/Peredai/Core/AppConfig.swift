import Foundation

enum AppConfig {
    /// Адреса сайту (Info.plist → PeredaiBase). Застосунок показує живий сайт — правки сайту одразу тут.
    static let base: URL = URL(string: (Bundle.main.object(forInfoDictionaryKey: "PeredaiBase") as? String) ?? "https://peredai.com.ua/")
        ?? URL(string: "https://peredai.com.ua/")!

    /// iCloud (CloudKit) — лише в підписаній збірці (PEREDAI_CLOUDKIT=YES у CI); без підпису контейнера немає, і CKContainer не чіпаємо.
    static var cloudKit: Bool {
        ((Bundle.main.object(forInfoDictionaryKey: "PeredaiCloudKit") as? String) ?? "NO").uppercased() == "YES"
    }

    static let appGroup = "group.ua.com.peredai"
    static let cloudContainer = "iCloud.ua.com.peredai"

    static var version: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
    }

    /// Як на сайті: російська мова телефона → російська, будь-яка інша → українська.
    static var lang: String {
        (Locale.preferredLanguages.first ?? "uk").hasPrefix("ru") ? "ru" : "uk"
    }
}

/// Кілька власних рядків застосунку (решта текстів — із сайту).
enum L10n {
    static func t(_ uk: String, _ ru: String) -> String { AppConfig.lang == "ru" ? ru : uk }

    static var tabHome: String { t("Квартири", "Квартиры") }
    static var tabHistory: String { t("Історія", "История") }
    static var tabStats: String { t("Статистика", "Статистика") }
    static var tabPrefs: String { t("Налаштування", "Настройки") }
    static var offlineTitle: String { t("Немає звʼязку з сайтом", "Нет связи с сайтом") }
    static var offlineText: String { t("Показання, які ви вже внесли, збережені на телефоні. Перевірте інтернет і спробуйте ще раз.",
                                       "Показания, которые вы уже внесли, сохранены на телефоне. Проверьте интернет и попробуйте ещё раз.") }
    static var retry: String { t("Спробувати ще", "Попробовать ещё") }
    static var close: String { t("Закрити", "Закрыть") }
    static var ok: String { "OK" }
    static var cancel: String { t("Скасувати", "Отмена") }
}

/// «2026-11-20» → дата (локальний календар, 00:00).
enum Day {
    static func parse(_ s: String) -> Date? {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }
}
