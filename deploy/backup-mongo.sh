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

# her-61: ảnh đại diện nằm trên đĩa (không trong Mongo) — gom cùng nhịp, giữ 14 bản.
# Khôi phục:  tar -xzf ~/backups/uploads-YYYY-MM-DD_HHMM.tgz -C ~
UPLOADS="${UPLOAD_DIR:-$HOME/her-uploads}"
if [ -d "$UPLOADS" ]; then
  tar -czf "$DIR/uploads-$STAMP.tgz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
  ls -1t "$DIR"/uploads-*.tgz | tail -n +15 | xargs -r rm -f
  echo "$(date '+%F %T') sao lưu ảnh xong: uploads-$STAMP.tgz ($(du -h "$DIR/uploads-$STAMP.tgz" | cut -f1))"
fi
