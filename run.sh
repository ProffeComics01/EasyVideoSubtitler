#!/usr/bin/env bash
# Avvio di sviluppo: server PHP con più worker e limiti di upload alzati.
cd "$(dirname "$0")"
PORT="${1:-8080}"
PHP_CLI_SERVER_WORKERS=6 exec php \
  -d upload_max_filesize=4G -d post_max_size=4G -d max_execution_time=0 -d memory_limit=512M \
  -S "0.0.0.0:$PORT" -t public
