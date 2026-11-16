import AVFoundation
import Foundation
import WebKit

/// 161-а: ліхтарик для камери з підказками — рідним AVCaptureDevice (WKWebView не дає `torch` через getUserMedia; журнал 12.11:
/// Safari каже «є ліхтарик», а ввімкнути не дає). Сайт (web/src/camera.js) шле `{on: true|false}`, відповідь — JSON-рядок `{"on": bool}`
/// або помилка (`no_torch`, `busy`) — тоді сайт пробує свій спосіб і, не вийшло, прибирає кнопку.
/// Камеру тримає WebKit; ліхтарик — властивість самого пристрою, тож ставимо його з процесу застосунку. Закрили камеру — сайт шле `{on: false}`.
@MainActor
final class NativeTorch: NSObject, WKScriptMessageHandlerWithReply {
    static let shared = NativeTorch()
    static let name = "peredaiTorch"

    /// Чи є ліхтарик на задній камері — для `PeredaiNative.torch` (симулятор і iPad без спалаху — немає).
    static var available: Bool { AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)?.hasTorch ?? false }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        let on = ((message.body as? [String: Any])?["on"] as? Bool) ?? false
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back), dev.hasTorch else {
            replyHandler(nil, "no_torch"); return
        }
        do {
            try dev.lockForConfiguration()
            defer { dev.unlockForConfiguration() }
            if on {
                guard dev.isTorchModeSupported(.on) else { replyHandler(nil, "no_torch"); return }
                try dev.setTorchModeOn(level: min(AVCaptureDevice.maxAvailableTorchLevel, 0.6))   // 60 %: ЖК під склом відблискує на повному
            } else if dev.torchMode != .off {
                dev.torchMode = .off
            }
            replyHandler(dev.torchMode != .off ? "{\"on\":true}" : "{\"on\":false}", nil)
        } catch {
            replyHandler(nil, "busy")
        }
    }
}
