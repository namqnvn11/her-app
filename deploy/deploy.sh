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
  # her-61: thư mục ảnh đại diện NGOÀI thư mục code + biến UPLOAD_DIR trong .env (chỉ thêm khi chưa có)
  mkdir -p "$HOME/her-uploads/avatars"
  grep -q '^UPLOAD_DIR=' .env || printf '\n# her-61: thư mục ảnh đại diện (nginx phát thẳng /uploads/)\nUPLOAD_DIR=%s/her-uploads\n' "$HOME" >> .env
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

  echo "== nginx: khối /uploads/ cho ảnh đại diện (her-61)"
  chmod o+x "$HOME" # www-data cần đi qua /home/ubuntu để đọc ~/her-uploads (home mặc định 750)
  NGX=/etc/nginx/sites-available/her
  INC=/etc/nginx/her-uploads.inc
  if ! sudo cmp -s "$APP_DIR/deploy/nginx-uploads.inc" "$INC"; then sudo cp "$APP_DIR/deploy/nginx-uploads.inc" "$INC"; NGX_CHANGED=1; fi
  if [ -f "$NGX" ] && ! grep -q 'her-uploads.inc' "$NGX"; then
    sudo cp "$NGX" "$NGX.bak-$(date +%Y%m%d%H%M%S)"
    # Chèn include vào MỌI khối server (cả khối 443 certbot tự tạo) — ngay sau dòng server_name
    sudo sed -i "s|^\(\s*\)server_name \(.*\);|\1server_name \2;\n\1include $INC;|" "$NGX"
    sudo sed -i 's|client_max_body_size 5m;|client_max_body_size 12m;|' "$NGX"
    NGX_CHANGED=1
  fi
  if [ "${NGX_CHANGED:-}" = 1 ]; then
    if sudo nginx -t; then sudo systemctl reload nginx; echo "nginx: đã cập nhật /uploads/";
    else echo "nginx -t LỖI — khôi phục bản cũ"; sudo cp "$(ls -t "$NGX".bak-* | head -1)" "$NGX"; sudo nginx -t; fi
  fi

  echo "== Trang chính sách quyền riêng tư (store yêu cầu)"
  cp "$APP_DIR/deploy/privacy.html" /var/www/her/privacy.html

  echo "== Trang web chính (her-48) -> /var/www/web"
  sudo mkdir -p /var/www/web && sudo chown -R "$USER":"$USER" /var/www/web
  rsync -a --delete "$APP_DIR/web/" /var/www/web/

  echo "== Kiểm tra"
  sleep 2
  curl -fsS http://127.0.0.1:4000/api/health && echo
  echo "XONG."
}

main "$@"
