# her-61 (04/09/2026): ảnh đại diện — nginx phát thẳng từ UPLOAD_DIR (backend/.env), Node không tốn công.
# deploy.sh copy file này sang /etc/nginx/her-uploads.inc và chèn `include /etc/nginx/her-uploads.inc;` vào các
# khối server của /etc/nginx/sites-available/her (cả khối 443 do certbot tạo), nâng client_max_body_size lên 12m.
# `^~` BẮT BUỘC: không có thì location regex đuôi .png/.jpg (cache 30 ngày) thắng và tìm file trong /var/www/her -> 404.
# Thư mục home phải cho nginx (www-data) đi qua: deploy.sh chạy `chmod o+x $HOME` (Ubuntu mặc định 750).
location ^~ /uploads/ {
    alias /home/ubuntu/her-uploads/;
    expires 7d;
    add_header Cache-Control "public";
}
