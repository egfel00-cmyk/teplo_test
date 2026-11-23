#!/usr/bin/env bash
# e2e-стенд одним запуском (184-я) — локально и в CI (.github/workflows/web.yml).
#   bash tests/e2e/stand.sh up          — чистая база SITE_DATA=/tmp/teplo_data, сайт 8013, стенды ХТМ 8099, Водоканала 8098, LocalBot 8096, обленерго 8097
#   bash tests/e2e/stand.sh fixtures    — картинки: ocr-lab (make.cjs + water.cjs → tests/ocr-lab/out), камера /tmp/cam/*.y4m, /tmp/two_meters.jpg,
#                                         /tmp/gas_low.jpg, /tmp/bill_photo.jpg, /tmp/bill_oct.pdf
#   bash tests/e2e/stand.sh run [имя …] — прогнать e2e (без имён — список tests/e2e/ci.list, SHARD=k/n — часть); итог — /tmp/e2e/summary.md и /tmp/e2e/results.tsv,
#                                         вывод каждого — /tmp/e2e/<имя>.log. Перед тестами со своей базой (ci.list: «!») — база чистая (стенды на месте).
#   bash tests/e2e/stand.sh down
# Тесты — только синтетика; секретов нет. Порты заняты — стенд не поднимется (смотреть /tmp/e2e/srv-*.log).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${SITE_DATA:-/tmp/teplo_data}"
OUT="${E2E_OUT:-/tmp/e2e}"
TMO="${E2E_TIMEOUT:-420}"
mkdir -p "$OUT"
export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null)}"

conf() {   # без коми в кінці: e2e_apple й інші дописують ключі заміною «];»
  cat > "$DATA/config.php" <<PHP
<?php return [
  'db' => ['dsn' => 'sqlite:$DATA/dev.sqlite'], 'cookie_secure' => false,
  'admins' => ['emails' => ['boss@teplo.test', 'pvadmin@example.ua']],
  'bot_username' => 'peredai_com_ua_bot', 'app_url' => 'http://127.0.0.1:8013',
  'htm_cab_base' => 'http://127.0.0.1:8099', 'vk_cab_base' => 'http://127.0.0.1:8098',
  'lb_base_mtve' => 'http://127.0.0.1:8096/', 'lb_base_brz' => 'http://127.0.0.1:8096/cab/', 'lb_base_brovk' => 'http://127.0.0.1:8096/aspx/',
  'relay_prefixes' => ['http://127.0.0.1:8097/'],
  'smtp_host' => '127.0.0.1', 'smtp_port' => '2526', 'smtp_user' => 'u', 'smtp_pass' => 'p', 'smtp_from' => 'noreply@peredai.com.ua'];
PHP
}

srv() {   # имя порт папка аргументы…
  local n="$1" port="$2" dir="$3"; shift 3
  (cd "$dir" && SITE_BASE= SITE_DATA="$DATA" nohup php -S "127.0.0.1:$port" "$@" > "$OUT/srv-$n.log" 2>&1 & echo $! > "$OUT/srv-$n.pid")
}

wait_port() { for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$1/" && return 0; sleep 0.2; done; echo "порт $1 не ответил" >&2; return 1; }

down() {
  local f   # bash бачить змінні того, хто викликав: без local цикл затирав $f у run (тест ставав «node srv-vk.pid»)
  for f in "$OUT"/srv-*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
  pkill -f "php -S 127.0.0.1:80(13|96|97|98|99)" 2>/dev/null || true
  sleep 0.3
}

fresh() {   # чистая база и стенды с нуля: cron квитанций и кабинеты помнят прошлые прогоны («same»)
  down
  rm -rf "$DATA" /tmp/htm-mock && mkdir -p "$DATA"
  conf
  cp -r "$ROOT/tests/htm-mock" /tmp/htm-mock && rm -f /tmp/htm-mock/storage/*.json /tmp/htm-mock/storage/*.jsonl /tmp/htm-mock/storage/*.txt
  rm -f /tmp/vkm_store.json /tmp/vkm_bill.txt /tmp/obl_mock_last.json /tmp/obl_mock_scn
  srv site 8013 "$ROOT" index.php
  srv htm 8099 /tmp/htm-mock -t public public/router.php
  srv vk 8098 "$ROOT" tests/vk-mock/router.php
  srv lb 8096 "$ROOT" tests/lb-mock/router.php
  srv obl 8097 "$ROOT" tests/obl-mock/router.php
  local p; for p in 8013 8099 8098 8096 8097; do wait_port "$p" || return 1; done
}

fixtures() {
  local lab="$ROOT/tests/ocr-lab"
  mkdir -p "$lab/out" /tmp/cam
  if [ ! -f "$lab/DSEG7Classic-Bold.woff2" ]; then   # шрифти ЖК для make.cjs (у git не йдуть): npm-пакет dseg
    local t; t="$(mktemp -d)"; (cd "$t" && npm pack dseg@0.46.0 --silent >/dev/null && tar xzf dseg-*.tgz) &&
      cp "$t/package/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2" "$t/package/fonts/DSEG14-Classic/DSEG14Classic-Bold.woff2" "$lab/"; rm -rf "$t"
  fi
  if [ ! -f "$lab/out/s774_energy.jpg" ]; then
    node "$lab/make.cjs" && cp "$lab"/*.jpg "$lab/out/" && rm -f "$lab"/*.jpg
  fi
  [ -f "$lab/out/w_novator.jpg" ] || node "$lab/water.cjs"
  [ -f "$lab/out/p_two_far.jpg" ] || node "$lab/water.cjs" water_pair.json
  [ -f "$lab/out/e8_rx.jpg" ] || node "$lab/heat.cjs" heat_err.json e8_rx > /dev/null   # e2e_heat_photo: екран помилки (heat_err.json)
  [ -f /tmp/cam/heat.y4m ] || ffmpeg -loglevel error -y -loop 1 -i "$lab/out/s774_energy.jpg" -t 2 -r 5 -vf scale=1000:1300 -pix_fmt yuv420p /tmp/cam/heat.y4m
  [ -f /tmp/cam/dark.y4m ] || ffmpeg -loglevel error -y -f lavfi -i color=c=0x101010:s=640x480:r=5 -t 2 -pix_fmt yuv420p /tmp/cam/dark.y4m
  # e2e_widget — віджет картки чату з коду (BotWidget::HTML)
  (cd "$ROOT" && php -r 'define("TEPLO",1); require "app/core.php"; require "app/telegram.php"; require "app/reminders.php"; require "app/widget.php"; file_put_contents("/tmp/w.html", BotWidget::HTML);')
  if [ ! -f /tmp/npmref/jsqr/package/dist/jsQR.js ]; then   # e2e_qr читає QR з екрана (jsQR, Apache-2.0)
    mkdir -p /tmp/npmref/jsqr && (cd /tmp/npmref/jsqr && npm pack jsqr@1.4.0 --silent >/dev/null && tar xzf jsqr-*.tgz)
  fi
  python3 -I - "$lab/out" <<'PY'
import sys, os
from PIL import Image, ImageDraw
out = sys.argv[1]
a, b = os.path.join(out, 'w_novator.jpg'), os.path.join(out, 'w_cold.jpg')
if os.path.exists(a) and os.path.exists(b) and not os.path.exists('/tmp/two_meters.jpg'):
    x, y = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    h = max(x.height, y.height); im = Image.new('RGB', (x.width + y.width, h), 'white'); im.paste(x, (0, 0)); im.paste(y, (x.width, 0)); im.save('/tmp/two_meters.jpg', quality=88)
if not os.path.exists('/tmp/gas_low.jpg'):
    im = Image.new('RGB', (1000, 1300), (200, 196, 188)); d = ImageDraw.Draw(im); d.rectangle((250, 1000, 750, 1120), fill=(20, 20, 20)); im.save('/tmp/gas_low.jpg', quality=88)
if not os.path.exists('/tmp/bill_photo.jpg'):
    im = Image.new('RGB', (800, 1100), 'white'); d = ImageDraw.Draw(im); d.rectangle((60, 60, 740, 140), outline='black', width=3); im.save('/tmp/bill_photo.jpg', quality=85)
if not os.path.exists('/tmp/bill_oct.pdf'):
    body = b'BT /F1 18 Tf 72 720 Td (Bill 10.2026) Tj ET'
    objs = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
            b'<< /Length %d >>\nstream\n' % len(body) + body + b'\nendstream', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    pdf, offs = b'%PDF-1.4\n', []
    for i, o in enumerate(objs, 1): offs.append(len(pdf)); pdf += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    x = len(pdf); pdf += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offs)
    pdf += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, x)
    open('/tmp/bill_oct.pdf', 'wb').write(pdf)
PY
}

run() {
  local list=("$@") fresh_before
  if [ ${#list[@]} -eq 0 ]; then mapfile -t list < <(grep -v '^\s*#' "$ROOT/tests/e2e/ci.list" | sed 's/ #.*//' | awk 'NF'); fi
  if [ -n "${SHARD:-}" ]; then   # SHARD=2/4 — кожен четвертий, починаючи з другого (паралельні машини CI)
    local k="${SHARD%/*}" n="${SHARD#*/}" i=0 part=()
    for it in "${list[@]}"; do [ $((i % n)) -eq $((k - 1)) ] && part+=("$it"); i=$((i + 1)); done
    list=("${part[@]}")
  fi
  : > "$OUT/results.tsv"
  local total=0 bad=0
  for item in "${list[@]}"; do
    fresh_before=0; case "$item" in '!'*) fresh_before=1; item="${item#!}";; esac
    local args envs=(); read -r -a args <<< "$item"   # «[ЗМІННА=знач …] e2e_x [арг …]» — середовище й аргументи тесту (шляхи — від tests/e2e)
    while [[ "${args[0]}" =~ ^[A-Z_]+= ]]; do envs+=("${args[0]}"); args=("${args[@]:1}"); done
    item="${args[0]}"; args=("${args[@]:1}")
    local f="$ROOT/tests/e2e/$item.cjs"; [ -f "$f" ] || f="$ROOT/tests/e2e/$item"
    local name; name="$(basename "$f" .cjs)"
    [ "$fresh_before" = 1 ] && fresh
    sqlite3 "$DATA/dev.sqlite" 'DELETE FROM rate_limits' 2>/dev/null || SITE_DATA="$DATA" php -r '$c = require getenv("SITE_DATA") . "/config.php"; try { (new PDO($c["db"]["dsn"]))->exec("DELETE FROM rate_limits"); } catch (Throwable $e) {}' 2>/dev/null
    local t0=$SECONDS
    (cd "$ROOT/tests/e2e" && env SITE_DATA="$DATA" "${envs[@]}" timeout "$TMO" node "$f" "${args[@]}") > "$OUT/$name.log" 2>&1; local rc=$?
    # формати тестів різні: «  OK  …» / « FAIL …», «ok   …» / «FAIL …», «✓ …» / «✗ …», одне «OK» / «FAIL»; «ERROR …» — тест упав
    local okn fln; okn=$(grep -cE '^\s*(OK|ok|✓)(\s|$)' "$OUT/$name.log"); fln=$(grep -cE '^\s*(FAIL|✗|ERROR)(\s|$)' "$OUT/$name.log")
    local st=ok; { [ $rc -ne 0 ] || [ "$fln" -gt 0 ] || [ "$okn" -eq 0 ]; } && st=FAIL; [ $rc -eq 124 ] && st=TIMEOUT
    total=$((total + 1)); [ "$st" != ok ] && bad=$((bad + 1))
    printf '%s\t%s\t%s\t%s\t%ss\n' "$name" "$st" "$okn" "$fln" "$((SECONDS - t0))" | tee -a "$OUT/results.tsv"
    # у журнал прогону (CI: артефакти з облачної сесії не завантажуються — лише журнал завдання): що саме впало
    if [ "$st" != ok ]; then grep -E '^\s*(FAIL|✗|ERROR)(\s|$)|Error|waiting for' "$OUT/$name.log" | head -8 | cut -c1-400 | sed 's/^/    │ /'; tail -3 "$OUT/$name.log" | cut -c1-300 | sed 's/^/    │ /'; fi
  done
  {
    echo "### e2e: $((total - bad)) из $total зелёные"
    echo; echo '| тест | итог | OK | FAIL | время |'; echo '|---|---|---|---|---|'
    awk -F'\t' '{ printf "| %s | %s | %s | %s | %s |\n", $1, ($2 == "ok" ? "✅" : "❌ " $2), $3, $4, $5 }' "$OUT/results.tsv"
    for n in $(awk -F'\t' '$2 != "ok" { print $1 }' "$OUT/results.tsv"); do
      echo; echo "<details><summary>$n</summary>"; echo; echo '```'; grep -E '^\s*(FAIL|✗|ERROR)(\s|$)|Error' "$OUT/$n.log" | head -20 | cut -c1-300; tail -5 "$OUT/$n.log" | cut -c1-300; echo '```'; echo '</details>'
    done
  } > "$OUT/summary.md"
  [ "$bad" -eq 0 ]
}

case "${1:-}" in
  up) fresh ;;
  fixtures) fixtures ;;
  run) shift; run "$@" ;;
  down) down ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
