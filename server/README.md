# WaveSync RU Server

Лёгкий российский WebSocket + HTTP-сервер для комнат синхронизации, точных часов (`ping/pong` за 15–30 мс по РФ) и временного обмена аудиофайлами с телефона (до 50 МБ, с поддержкой `Range`-запросов и автоочисткой через 12 часов).

## Быстрый запуск на RU VPS (Timeweb / Selectel / Aeza)

```bash
cd server
npm install
PORT=3080 npm start
```

Для постоянной работы в фоне через `pm2`:

```bash
npm i -g pm2
pm2 start index.js --name wavesync-ru
pm2 save
```

## Пример конфига Nginx (HTTPS + WebSocket)

```nginx
server {
    server_name api.ваш-домен.ru;
    client_max_body_size 55M;

    location /ws {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
    }
}
```
