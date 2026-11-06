#!/bin/bash
# Подключение домена peredai.com.ua к сайту teplo_test (запускать на сервере от root, один раз):
#   bash /srv/sites/teplo_test/tools_peredai.sh
# Что делает: 1) добавляет peredai.com.ua в ingress cloudflared (туннель управляется локально, сервис как у pokabot.xyz —
# http://localhost:8080), проверяет конфиг и перезапускает туннель (при ошибке — откат); 2) настраивает сайт под домен
# (tools_site_add.sh --domain); 3) печатает короткую сводку. Повторный запуск безопасен. Полный журнал — /root/peredai.log.
set -u
DOM=peredai.com.ua
LOG=/root/peredai.log
exec > >(tee "$LOG") 2>&1

CF=$(systemctl cat cloudflared 2>/dev/null | grep -oP -- '--config[= ]\K\S+' | head -1)
[ -z "$CF" ] && CF=$(ls /etc/cloudflared/config.y*ml /root/.cloudflared/config.y*ml 2>/dev/null | head -1)
echo "== конфиг туннеля: ${CF:-не найден}"
if [ -z "$CF" ]; then echo "!! конфиг cloudflared не найден"; systemctl cat cloudflared 2>&1 | head -20; exit 1; fi

cp "$CF" "$CF.bak-peredai"
if grep -q "$DOM" "$CF"; then
  echo "== $DOM уже есть в конфиге"
else
  sed -i -E "s/^(\s*)- service: *http_status:404/\1- hostname: $DOM\n\1  service: http:\/\/localhost:8080\n&/" "$CF"
  grep -q "$DOM" "$CF" || echo "!! не нашёл строку http_status:404 — правку не внёс"
fi
echo "== ingress:"; sed -n '/ingress:/,$p' "$CF"

TUN=fail
if cloudflared tunnel --config "$CF" ingress validate </dev/null; then
  cloudflared tunnel --config "$CF" ingress rule "https://$DOM" </dev/null
  systemctl restart cloudflared; sleep 4
  TUN=$(systemctl is-active cloudflared)
else
  cp "$CF.bak-peredai" "$CF"
  echo "!! конфиг не прошёл проверку — откат, cloudflared не перезапускал"
fi

echo "== настройка сайта под $DOM"
bash /srv/app/tools_site_add.sh teplo_test --domain "$DOM" </dev/null
sleep 2

NEW=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOM" http://localhost:8080/)
CSP=$(curl -s -D - -o /dev/null -H "Host: $DOM" http://localhost:8080/ | grep -ci 'wasm-unsafe-eval')
OLDP=$(curl -s -H "Host: $DOM" http://localhost:8080/ | grep -c '/teplo_test/')
OLD=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://pokabot.xyz/teplo_test/)

echo
echo "===== ИТОГ ====="
echo "туннель:            $TUN"
echo "$DOM на сервере: $NEW (ждём 200)"
echo "wasm в CSP:         $CSP (ждём 1)"
echo "старые пути:        $OLDP (ждём 0)"
echo "старый адрес:       $OLD"
echo "журнал:             $LOG"
