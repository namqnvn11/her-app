#!/usr/bin/env bash
# HER — cài máy chủ lần đầu trên Ubuntu 24.04 (AWS Lightsail). Chạy 1 lần bằng user ubuntu:
#   bash setup-server.sh
# Cài: Node 20, MongoDB 7 (chỉ nghe localhost), nginx, pm2, tường lửa, swap 2 GB, múi giờ VN,
# clone code về /home/ubuntu/her-app. KHÔNG chứa bí mật — .env tạo ở bước sau (xem hướng dẫn).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/namqnvn11/her-app.git}"
APP_DIR="$HOME/her-app"

echo "== 1/8 Múi giờ Việt Nam + cập nhật hệ thống"
sudo timedatectl set-timezone Asia/Ho_Chi_Minh
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl gnupg git ufw nginx unzip rsync

echo "== 2/8 Swap 2 GB (build web của Expo cần RAM, máy 2 GB dễ thiếu)"
if ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== 3/8 Node 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

echo "== 4/8 MongoDB 8 (bản hỗ trợ chính thức Ubuntu 24.04; kèm mongosh/mongodump/mongorestore)"
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list >/dev/null
sudo apt-get update -y && sudo apt-get install -y mongodb-org
# Mongo CHỈ nghe 127.0.0.1 (mặc định) — không bao giờ mở cổng 27017 ra internet
sudo systemctl enable --now mongod

echo "== 5/8 Tường lửa: chỉ mở SSH, HTTP, HTTPS"
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable

echo "== 6/8 Lấy code"
if [ ! -d "$APP_DIR/.git" ]; then git clone "$REPO_URL" "$APP_DIR"; fi
cd "$APP_DIR/backend" && npm ci --omit=dev

echo "== 7/8 nginx: /api -> Node (thư mục web chỉ dùng khi deploy.sh --with-web)"
sudo mkdir -p /var/www/her && sudo chown -R "$USER":"$USER" /var/www/her
printf '<!doctype html><meta charset="utf-8"><p>HER API đang chạy. Dùng app hoặc bản web.</p>' > /var/www/her/index.html
sudo cp "$APP_DIR/deploy/nginx-her.conf" /etc/nginx/sites-available/her
sudo ln -sf /etc/nginx/sites-available/her /etc/nginx/sites-enabled/her
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "== 8/8 Thư mục sao lưu + cron mỗi đêm 02:30"
mkdir -p "$HOME/backups"
( crontab -l 2>/dev/null | grep -v backup-mongo.sh; echo "30 2 * * * bash $APP_DIR/deploy/backup-mongo.sh >> $HOME/backups/backup.log 2>&1" ) | crontab -

echo
echo "XONG phần cài. Tiếp theo (xem docs-her/huong-dan-deploy-aws.md):"
echo "  1) tạo $APP_DIR/backend/.env   2) nạp dữ liệu   3) bash $APP_DIR/deploy/deploy.sh   4) HTTPS (DuckDNS)"
