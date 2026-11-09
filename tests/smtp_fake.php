<?php
// Поддельный SMTP-сервер для tests/server.php (Mail::smtp): 127.0.0.1:<порт>, без TLS (клиент пускает открытый канал только на localhost),
// AUTH PLAIN/LOGIN с логином u / паролем p, письмо — в файл. Запуск: php tests/smtp_fake.php <порт> <файл> [сколько соединений]
$port = (int)($argv[1] ?? 2525); $out = (string)($argv[2] ?? '/tmp/smtp_fake.eml'); $n = (int)($argv[3] ?? 3);
$srv = stream_socket_server("tcp://127.0.0.1:$port", $en, $es); if (!$srv) { fwrite(STDERR, "listen: $es\n"); exit(1); }
file_put_contents($out . '.ready', '1');
for ($k = 0; $k < $n; $k++) {
  $c = @stream_socket_accept($srv, 20); if (!$c) break;
  $say = fn($l) => fwrite($c, $l . "\r\n");
  $say('220 fake ESMTP'); $data = null; $auth = false;
  while (($l = fgets($c)) !== false) {
    $l = rtrim($l, "\r\n"); $u = strtoupper($l);
    if (str_starts_with($u, 'EHLO')) { $say('250-fake'); $say('250-AUTH LOGIN PLAIN'); $say('250 8BITMIME'); }
    elseif (str_starts_with($u, 'AUTH PLAIN ')) { $auth = base64_decode(substr($l, 11)) === "\0u\0p"; $say($auth ? '235 ok' : '535 5.7.8 Authentication failed'); }
    elseif ($u === 'AUTH LOGIN') { $say('334 VXNlcm5hbWU6'); $us = base64_decode(rtrim(fgets($c))); $say('334 UGFzc3dvcmQ6'); $pw = base64_decode(rtrim(fgets($c))); $auth = $us === 'u' && $pw === 'p'; $say($auth ? '235 ok' : '535 bad'); }
    elseif (str_starts_with($u, 'MAIL FROM:')) $say($auth ? '250 ok' : '530 auth required');
    elseif (str_starts_with($u, 'RCPT TO:')) $say(str_contains($u, 'NOBODY@') ? '550 no such user' : '250 ok');
    elseif ($u === 'DATA') { $say('354 go'); $data = '';
      while (($d = fgets($c)) !== false) { if ($d === ".\r\n") break; $data .= $d; }
      file_put_contents($out, $data, FILE_APPEND); $say('250 queued'); }
    elseif ($u === 'QUIT') { $say('221 bye'); break; }
    else $say('500 ?');
  }
  fclose($c);
}
