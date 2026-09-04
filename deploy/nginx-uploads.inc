# her-61 (04/09/2026): ảnh đại diện — nginx phát thẳng từ UPLOAD_DIR (backend/.env), Node không tốn công.
# deploy.sh tự chèn `include .../nginx-uploads.inc;` vào các khối server của /etc/nginx/sites-available/her
# (cả khối 443 do certbot tạo) và nâng client_max_body_size lên 12m (ảnh tối đa 10 MB + phần bao multipart).
location /uploads/ {
    alias /home/ubuntu/her-uploads/;
    expires 7d;
    add_header Cache-Control "public";
}
