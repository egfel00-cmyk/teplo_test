#!/usr/bin/env bash
# Запуск мок-стенда ТОЛЬКО на localhost. Открыть: http://127.0.0.1:8099/
# Наружу стенд не выставлять (см. README). Остановить — Ctrl+C.
set -e
cd "$(dirname "$0")"
HOST="${STAND_HOST:-127.0.0.1}"
PORT="${STAND_PORT:-8099}"
echo "htm-mock → http://$HOST:$PORT/   (Ctrl+C — стоп)"
exec php -S "$HOST:$PORT" -t public public/router.php
