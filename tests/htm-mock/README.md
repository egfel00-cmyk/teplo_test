# htm-mock v2 — локальный тестовый стенд кабинета ХТМ

Повторяет **контракт** кабинета, снятый Claude в Chrome 01.11.2026 (`../cluade chrome out/`), чтобы разрабатывать и тестировать адаптер, не трогая боевой сайт. Вёрстка нейтральная, на каждой странице плашка «ТЕСТОВИЙ СТЕНД», данные вымышленные. **Только localhost / LAN, наружу не публиковать.**

## Запуск
Нужен PHP 8.0+ с `mbstring` (на Mac: `brew install php`).
```bash
./start.sh            # → http://127.0.0.1:8099/   (Windows: start.bat)
php tests/smoke.php   # 23 проверки контракта → «23 OK, 0 FAIL»
```
Вход: `test@stand.local` / `stand-pass-123`.

## Что воспроизведено (по снятию)
| Что | Как на стенде |
|---|---|
| Кодировка | ответы и тело POST в **windows-1251** |
| Вход | `POST /cabinet/login`: `email` + `passw` + `email-signin`; `rash` + `lastn` + `acc-signin` закрыт (абонент зарегистрирован). CSRF нет. Успех — ссылка `/cabinet/logout`, title «…Стан особового рахунку». Cookie `CABSESSID`, `cablang` |
| Навигация | `/cabinet`, `/cabinet/list`, `/cabinet/{ACCOUNT}/{SURNAME}`, `/cabinet/heat/{ACCOUNT}/{SURNAME}`, `/cabinet/heat/viewall/…/{METER_SN}`, `/cabinet/logout` |
| Прибор | заголовок «…: ПУ Sharky 774, №…», таблица с «Величина перехідної витрати» и «Повірений до» |
| База | строка «Показання, що пройшли раніше за розрахунком», ячейки `#head_LastDtPok … #head_ErrorKod`, класс `bg-info-gray` |
| Окно 5–25 | вне окна **тега `<form>` нет**, текст «…тимчасово зупинений…»; в окне — форма, `var min_date / max_date` |
| Форма | `LastDtPok … ErrorKod`, `Phone`, `Email`, `Note`, кнопка «Зберегти показання» — **имена — гипотеза до 05.11** (`config/stand.json`) |
| Проверки формы | точка как разделитель, температура не 0, только текущий месяц, одна запись на дату (последнюю можно перезаписать), телефон и email обязательны → `.alert-danger.flash` |
| Результат | асинхронный: запись «очікують перевірки» → через `robot_delay` робот ставит `td.bg-success` + «Статус: Показання успішно додані в базу даних.» или `td.bg-danger` + «Статус: Показання не принйяті з причини: …» (с опечаткой, как на живом сайте) |
| Правила робота | 11 правил памятки ХТМ (`app/robot.php`) — те же пороги, что в `web/src/rules.js` |

## Управление
- `/stand/admin` — сценарий, **дата стенда** (чтобы окно было открыто), задержка робота, «запустить робота сейчас», сброс.
- Заголовки для тестов: `X-Mock-Scenario`, `X-Mock-Today: 2026-11-10`, `X-Mock-Robot-Delay: 0`.
- Сценарии: `ok`, `bad_credentials`, `account_login_closed`, `window_open`, `period_closed`, `robot_reject`, `captcha`, `session_expired`, `server_500`, `maintenance`, `markup_changed`, `slow`.
- `/stand/state` — состояние (JSON), `/stand/journal` — журнал запросов адаптера (пароли не пишутся).

## Что поправить после 5 ноября (этап D)
Имена полей формы, телефона, email, примечания и кнопки; hidden-поля; тексты flash и строки «ожидает проверки»; тексты ошибок входа — всё в `config/stand.json`.
