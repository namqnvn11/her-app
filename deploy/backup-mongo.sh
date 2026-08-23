#!/usr/bin/env bash
# HER — sao lưu MongoDB mỗi đêm (cron đặt sẵn trong setup-server.sh). Giữ 14 bản gần nhất.
# Khôi phục 1 bản:  mongorestore --gzip --archive=~/backups/her_gym-YYYY-MM-DD_HHMM.gz --drop
set -euo pipefail
DIR="$HOME/backups"
mkdir -p "$DIR"
STAMP=$(date +%Y-%m-%d_%H%M)
mongodump --db her_gym --gzip --archive="$DIR/her_gym-$STAMP.gz"
ls -1t "$DIR"/her_gym-*.gz | tail -n +15 | xargs -r rm -f
echo "$(date '+%F %T') sao lưu xong: her_gym-$STAMP.gz ($(du -h "$DIR/her_gym-$STAMP.gz" | cut -f1))"
