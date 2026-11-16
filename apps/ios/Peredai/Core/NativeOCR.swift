import Foundation
import UIKit
import Vision
import WebKit

/// 160-а: розпізнавання тексту вбудованим Vision — на телефоні, безкоштовно, без 30 МБ PaddleOCR (власник 16.11: «щоб камеру наводити
/// й одразу зчитувати показання або завантажувати фото й одразу розпізнавати»).
/// Сайт (web/src/recognize.js → `natRead`) шле кадр JPEG data URL, уже повернутий за EXIF; відповідь — JSON-рядок
/// `{lines: [{text, score, x, y, w, h, angle, alts}], w, h, ms, langs}` у пікселях цього кадру, як `TeploOCR.read`.
/// Тип лічильника, модель і показання розбирає сайт (web/src/ocrparse.js) — той самий розбір, що в браузері, тож правки розбору
/// одразу працюють і тут. Не прочитав Vision — сайт сам візьме свій рушій.
@MainActor
final class NativeOCR: NSObject, WKScriptMessageHandlerWithReply {
    static let shared = NativeOCR()
    static let name = "peredaiOcr"

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let img = body["img"] as? String else {
            replyHandler(nil, "bad_request"); return
        }
        let fast = (body["fast"] as? Bool) ?? false
        DispatchQueue.global(qos: .userInitiated).async {
            let (json, err) = NativeOCR.run(dataURL: img, fast: fast)
            Task { @MainActor in replyHandler(json, err) }
        }
    }

    /// Vision на одному кадрі. `fast` — кадр камери: дрібний текст (< 1,5 % висоти) не шукаємо.
    nonisolated static func run(dataURL: String, fast: Bool) -> (String?, String?) {
        let t0 = Date()
        let b64 = dataURL.split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
        guard let data = Data(base64Encoded: b64), let ui = UIImage(data: data), let cg = ui.cgImage else { return (nil, "bad_image") }
        return run(cgImage: cg, fast: fast, t0: t0)
    }

    nonisolated static func run(cgImage cg: CGImage, fast: Bool, t0: Date = Date()) -> (String?, String?) {
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        let req = VNRecognizeTextRequest()
        req.revision = VNRecognizeTextRequestRevision3
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false          // цифри табло — без «виправлень» словником
        req.automaticallyDetectsLanguage = false
        // підписи Гкал / кВт·год / м³ кирилицею й латиницею; мови — лише ті, що знає ця iOS
        let have = (try? req.supportedRecognitionLanguages()) ?? []
        let langs = ["uk-UA", "ru-RU", "en-US"].filter { have.contains($0) }
        if !langs.isEmpty { req.recognitionLanguages = langs }
        if fast { req.minimumTextHeight = 0.015 }
        do {
            try VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:]).perform([req])
        } catch {
            return (nil, "vision_failed")
        }
        var lines: [[String: Any]] = []
        for o in req.results ?? [] {
            let cands = o.topCandidates(3)
            guard let top = cands.first, !top.string.isEmpty else { continue }
            // кути рамки рядка: Vision — 0…1 від лівого нижнього, сайт — пікселі від лівого верхнього
            func px(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * w, y: (1 - p.y) * h) }
            let tl = px(o.topLeft), tr = px(o.topRight), bl = px(o.bottomLeft), br = px(o.bottomRight)
            let lw = hypot(tr.x - tl.x, tr.y - tl.y), lh = hypot(bl.x - tl.x, bl.y - tl.y)
            let cx = (tl.x + tr.x + bl.x + br.x) / 4, cy = (tl.y + tr.y + bl.y + br.y) / 4
            var line: [String: Any] = [
                "text": top.string,
                "score": (Double(top.confidence) * 1000).rounded() / 1000,
                "x": Int((cx - lw / 2).rounded()), "y": Int((cy - lh / 2).rounded()),
                "w": Int(lw.rounded()), "h": Int(lh.rounded()),
                "angle": (Double(atan2(tr.y - tl.y, tr.x - tl.x)) * 1000).rounded() / 1000,
            ]
            let alts = cands.dropFirst().map { $0.string }.filter { $0 != top.string }
            if !alts.isEmpty { line["alts"] = alts }
            lines.append(line)
        }
        let out: [String: Any] = ["lines": lines, "w": Int(w), "h": Int(h), "ms": Int(Date().timeIntervalSince(t0) * 1000), "langs": langs]
        guard let js = try? JSONSerialization.data(withJSONObject: out), let s = String(data: js, encoding: .utf8) else { return (nil, "json") }
        return (s, nil)
    }

    #if DEBUG
    /// CI: `-PeredaiOcrTest <файл>` — прочитати картинку Vision і вивести рядки в журнал (скрини CI → log.txt).
    nonisolated static func selfTest(path: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let data = FileManager.default.contents(atPath: path), let ui = UIImage(data: data), let cg = ui.cgImage else {
                NSLog("[peredai] OCR test: no image at \(path)"); return
            }
            for fast in [false, true] {
                let (json, err) = run(cgImage: cg, fast: fast)
                guard let json, let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
                    NSLog("[peredai] OCR test fast=\(fast): error \(err ?? "?")"); continue
                }
                let ls = (o["lines"] as? [[String: Any]]) ?? []
                NSLog("[peredai] OCR test fast=\(fast): \(ls.count) lines, \(o["ms"] ?? 0) ms, \(o["w"] ?? 0)x\(o["h"] ?? 0), langs \(o["langs"] ?? [])")
                for l in ls.prefix(25) {
                    NSLog("[peredai] OCR line: \(l["text"] ?? "") | \(l["score"] ?? 0) | \(l["x"] ?? 0),\(l["y"] ?? 0) \(l["w"] ?? 0)x\(l["h"] ?? 0) | \((l["alts"] as? [String])?.joined(separator: " / ") ?? "")")
                }
            }
        }
    }
    #endif
}
