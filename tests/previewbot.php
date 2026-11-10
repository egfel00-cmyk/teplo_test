<?php
// previewBot() из index.php: роботы превью получают карточку, встроенные браузеры приложений (Instagram, Facebook…) — сайт.
// 95-я: ссылка в сторис Instagram открывала карточку вместо сайта. Запуск: php tests/previewbot.php
declare(strict_types=1);
$src = (string)file_get_contents(__DIR__ . '/../index.php');
if (!preg_match('~function previewBot\(string \$ua\): bool \{.*?\n\}~s', $src, $m)) { echo "FAIL: previewBot не найдена в index.php\n"; exit(1); }
eval($m[0]);
$cases = [
  // люди — сайт
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 356.0.0.21.107 (iPhone15,2; iOS 18_1; ru_RU; ru; scale=3.00; 1179x2556)', false, 'Instagram iPhone'],
  ['Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 Instagram 352.0.0.38.100 Android', false, 'Instagram Android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.108]', false, 'Facebook iPhone'],
  ['Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0 Mobile Safari/537.36 Viber/24.9.1.0', false, 'Viber Android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.10.0.40 (like Safari/8618.1.15.10.15)', false, 'Snapchat iPhone'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', false, 'Safari'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0', false, 'Firefox'],
  // роботы — карточка
  ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', true, 'facebookexternalhit (и Instagram)'],
  ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', true, 'meta-externalagent'],
  ['TelegramBot (like TwitterBot)', true, 'TelegramBot'],
  ['WhatsApp/2.24.21.80 A', true, 'WhatsApp'],
  ['Viber', true, 'Viber без браузера'],
  ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', true, 'Discordbot'],
  ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', true, 'Slackbot'],
  ['Pinterest/0.2 (+http://www.pinterest.com/bot.html)', true, 'Pinterest'],
];
$fail = 0;
foreach ($cases as [$ua, $want, $name]) { $got = previewBot($ua); if ($got !== $want) { $fail++; echo "FAIL: $name — " . ($got ? 'карточка' : 'сайт') . "\n"; } }
echo ($fail ? "FAIL $fail" : 'ok') . ' — previewBot ' . count($cases) . "\n";
exit($fail ? 1 : 0);
