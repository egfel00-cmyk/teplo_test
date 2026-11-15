import CloudKit
import Foundation

/// Копія стану в iCloud людини (приватна база CloudKit — бачить лише власник Apple ID, ми — ні). Без акаунта на сайті:
/// новий iPhone/iPad з тим самим Apple ID підтягує квартири й показання. З акаунтом (email/Telegram) — ще й сервер, як на сайті.
@MainActor
final class CloudBackup {
    static let shared = CloudBackup()

    private lazy var container: CKContainer? = AppConfig.cloudKit ? CKContainer(identifier: AppConfig.cloudContainer) : nil
    private let recordID = CKRecord.ID(recordName: "state")
    private let recordType = "AppState"
    private var pending: (json: String, at: Date)?
    private var timer: Task<Void, Never>?

    private init() {}

    var enabled: Bool { container != nil }

    func available() async -> Bool {
        guard let c = container else { return false }
        do { return try await c.accountStatus() == .available } catch { return false }
    }

    /// Часті збереження зливаємо: вивантаження — через 20 с тиші (і одразу — при згортанні застосунку, `flush`).
    func scheduleUpload(json: String, at: Date) {
        guard enabled else { return }
        pending = (json, at)
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            if Task.isCancelled { return }
            await self?.flush()
        }
    }

    func flush() async {
        guard let c = container, let p = pending else { return }
        pending = nil
        guard await available() else { return }
        let db = c.privateCloudDatabase
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("state-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: tmp) }
        do {
            try Data(p.json.utf8).write(to: tmp)
            let rec: CKRecord
            if let existing = try? await db.record(for: recordID) {
                rec = existing
            } else {
                rec = CKRecord(recordType: recordType, recordID: recordID)
            }
            rec["at"] = p.at
            rec["state"] = CKAsset(fileURL: tmp)
            _ = try await db.modifyRecords(saving: [rec], deleting: [], savePolicy: .changedKeys)
        } catch {
            NSLog("[peredai] iCloud: \(error.localizedDescription)")
        }
    }

    func fetch() async -> (json: String, at: Date)? {
        guard let c = container, await available() else { return nil }
        do {
            let rec = try await c.privateCloudDatabase.record(for: recordID)
            guard let asset = rec["state"] as? CKAsset, let url = asset.fileURL,
                  let d = try? Data(contentsOf: url), let s = String(data: d, encoding: .utf8) else { return nil }
            return (s, (rec["at"] as? Date) ?? .distantPast)
        } catch {
            return nil
        }
    }
}
