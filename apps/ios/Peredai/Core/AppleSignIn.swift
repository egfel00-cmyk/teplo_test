import AuthenticationServices
import CryptoKit
import UIKit

/// «Увійти через Apple»: сайт просить (`{t: 'apple'}`), iOS показує системне вікно, токен іде назад на сайт (`TeploHost.apple`),
/// а сайт — на сервер, який перевіряє підпис Apple (app/apple.php). Пароль і e-mail людини застосунок не бачить.
@MainActor
final class AppleSignIn: NSObject {
    static let shared = AppleSignIn()

    private var nonce = ""
    private var controller: ASAuthorizationController?

    func start() {
        nonce = Self.randomNonce()
        let req = ASAuthorizationAppleIDProvider().createRequest()
        req.requestedScopes = [.fullName, .email]
        req.nonce = Self.sha256(nonce)
        let c = ASAuthorizationController(authorizationRequests: [req])
        c.delegate = self
        c.presentationContextProvider = self
        controller = c
        c.performRequests()
    }

    private func reply(_ obj: [String: String]) {
        controller = nil
        guard let data = try? JSONSerialization.data(withJSONObject: obj), let js = String(data: data, encoding: .utf8) else { return }
        WebHost.shared.run("window.TeploHost && window.TeploHost.apple && window.TeploHost.apple(\(js))")
    }

    static func randomNonce(_ length: Int = 32) -> String {
        let chars = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var out = ""
        var rng = SystemRandomNumberGenerator()
        for _ in 0..<length { out.append(chars[Int(rng.next() % UInt64(chars.count))]) }
        return out
    }

    static func sha256(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension AppleSignIn: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated {
            guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let t = cred.identityToken, let token = String(data: t, encoding: .utf8) else {
                reply(["err": "failed"])
                return
            }
            let name = [cred.fullName?.givenName, cred.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
            reply(["token": token, "nonce": nonce, "name": name])
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated {
            let canceled = (error as? ASAuthorizationError)?.code == .canceled
            reply(["err": canceled ? "cancel" : "failed"])
        }
    }
}

extension AppleSignIn: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
}
