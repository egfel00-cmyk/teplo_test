# «передай» для iPhone

Нативна оболонка (Swift, UIKit + SwiftUI, iOS 17+) над живим сайтом https://peredai.com.ua/ — правки сайту одразу в застосунку.
Нативне поверх сайту: вкладки, нагадування за 4 дні до кінця вікна, Live Activity (Dynamic Island), копія даних у iCloud, вібровідгук.

- `project.yml` — проєкт XcodeGen (`brew install xcodegen && xcodegen generate` → `Peredai.xcodeproj`, у git не кладемо).
- `Peredai/` — застосунок: `App/` (вкладки, посилання, нагадування), `Web/WebHost.swift` (WKWebView + міст), `Core/` (копія стану, iCloud, строки, Live Activity).
- `PeredaiWidgets/` — розширення WidgetKit: Live Activity (заблокований екран і Dynamic Island).
- `Shared/` — спільне для застосунку й розширення (дані Live Activity, значки й кольори видів).

Міст із сайтом — `web/src/app.js` (154-а): сайт → `window.webkit.messageHandlers.peredai` (`route`, `sched`, `state`, `haptic`),
застосунок → `window.TeploHost` (`go`, `open`, `sched`, `restore`). e2e — `tests/e2e/e2e_appbridge.cjs`.

Збірка — `.github/workflows/ios.yml` (маки GitHub): завжди — для симулятора без підпису; TestFlight — коли є змінна `APPLE_TEAM_ID`
і секрети `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`. Ідентифікатори: `ua.com.peredai.app`, `ua.com.peredai.app.widgets`,
`group.ua.com.peredai`, `iCloud.ua.com.peredai`.
