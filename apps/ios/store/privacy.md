# App Store Connect → App Privacy (анкета) — ответы по коду (154-я)

Tracking (отслеживание между приложениями/сайтами других компаний): **нет**. Реклама: нет. Данные третьим лицам для рекламы: нет.

| Тип (App Store) | Собираем? | Связано с человеком | Зачем (Purposes) | Откуда в коде |
| --- | --- | --- | --- | --- |
| Contact Info → Email Address | да, только при входе (почта, Apple) | да | App Functionality | `users.email`, `user_identities` (apple) |
| Contact Info → Name | да, если дал Telegram/Apple | да | App Functionality | `users.name` |
| User Content → Photos | да: копия фото счётчика до 90 дней (вошедшие; гости — только с согласием на аналитику) | да (вошедшие) | App Functionality, Product Personalization → нет; **Analytics → нет**; «Other: improve recognition» → App Functionality | `photos`, `/api/recognize/upload` |
| User Content → Other User Content | да: показания, квартиры, поставщики — при синхронизации | да | App Functionality | `user_state` |
| User Content → Customer Support | да: отзывы | да, если вошёл | App Functionality | `feedback` |
| Identifiers → User ID | да | да | App Functionality | `users.id`, Telegram ID, Apple `sub` |
| Usage Data → Product Interaction | только с согласием (баннер cookie) | нет (случайный id браузера) | Analytics | `events`, `visits` |
| Location | **нет** (адрес квартиры вводит сам человек — это User Content) | — | — | — |
| Financial Info | нет (реквизиты поставщиков — не данные человека; токен monobank не уходит на сервер) | — | — | `web/src/mono.js` |
| Diagnostics | нет | — | — | — |

Доступы к кабинетам поставщиков (если человек подключил «Відправити у фоні») — Other User Content (App Functionality), хранятся зашифрованными (`cab_creds`).
iCloud (CloudKit, приватная база) — данные человека в ЕГО iCloud, нам не видны: в анкету как «collected» не идёт (не покидает экосистему пользователя к нам).
Export compliance: `ITSAppUsesNonExemptEncryption = NO` (только HTTPS системы).
Возрастной рейтинг: 4+. Категория: Utilities (вторичная — Finance). Страна: Украина (и все, где есть украиноязычные — по желанию владельца).
