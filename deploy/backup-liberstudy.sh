#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="/var/backups/liberstudy"
STAMP="$(date +%F_%H-%M-%S)"
TMP_DIR="$BACKUP_ROOT/$STAMP"

mkdir -p "$TMP_DIR"

sqlite3 /var/lib/liberstudy/database.db ".backup '$TMP_DIR/database.db'"
sqlite3 /var/lib/liberstudy/live_data.db ".backup '$TMP_DIR/live_data.db'"
tar -czf "$TMP_DIR/runs.tar.gz" -C /var/lib/liberstudy/static runs

# 保留最近 7 天
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;
