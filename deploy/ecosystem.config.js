// pm2: giữ backend chạy, tự khởi động lại khi lỗi hoặc khi máy chủ reboot (pm2 startup)
module.exports = {
  apps: [
    {
      name: "her-backend",
      cwd: __dirname + "/../backend",
      script: "server.js",
      instances: 1, // 1 tiến trình — cache cài đặt (her-47) và job nền completeSweep chạy 1 nơi
      autorestart: true,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
      out_file: process.env.HOME + "/.pm2/logs/her-backend-out.log",
      error_file: process.env.HOME + "/.pm2/logs/her-backend-err.log",
      time: true,
    },
  ],
};
