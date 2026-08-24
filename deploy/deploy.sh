#!/usr/bin/env bash
# HER — cập nhật code API lên máy chủ (chạy mỗi lần có bản mới). Bằng user ubuntu:
#   bash ~/her-app/deploy/deploy.sh             # chỉ API (mặc định — máy chủ phục vụ app)
#   bash ~/her-app/deploy/deploy.sh --with-web  # kèm build bản web xem tạm, đặt vào nginx
set -euo pipefail

# TOÀN BỘ logic nằm trong main() và chỉ gọi ở DÒNG CUỐI — vì script tự `git pull` chính nó:
# không bọc thế này thì bash đọc file dở dang giữa lúc file bị thay, hành vi khó lường
# (đã dính 24/08: bản mới thêm bước copy privacy.html nhưng lần deploy đó chạy theo bản cũ).
main() {
  APP_DIR="$HOME/her-app"
  cd "$APP_DIR"

  echo "== Lấy code mới"
  git pull --ff-only

  echo "== Backend"
  cd "$APP_DIR/backend"
  [ -f .env ] || { echo "THIẾU backend/.env — xem hướng dẫn bước 4"; exit 1; }
  npm ci --omit=dev
  echo "== Migration (cập nhật DB theo code mới — mỗi file chỉ chạy 1 lần)"
  npm run migrate
  pm2 startOrRestart "$APP_DIR/deploy/ecosystem.config.js" --update-env
  pm2 save >/dev/null

  if [ "${1:-}" = "--with-web" ]; then
    echo "== Web (Expo export) — mất 1–3 phút"
    cd "$APP_DIR/mobile"
    npm ci
    rm -rf dist
    npx expo export --platform web
    rsync -a --delete dist/ /var/www/her/
  fi

  echo "== Trang chính sách quyền riêng tư (store yêu cầu)"
  cp "$APP_DIR/deploy/privacy.html" /var/www/her/privacy.html

  echo "== Kiểm tra"
  sleep 2
  curl -fsS http://127.0.0.1:4000/api/health && echo
  echo "XONG."
}

main "$@"
