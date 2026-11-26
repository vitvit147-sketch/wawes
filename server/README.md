# WaveSync RU Server

Лёгкий российский WebSocket + HTTP-сервер для комнат синхронизации, точных часов (`ping/pong` за 15–30 мс по РФ) и временного обмена аудиофайлами с телефона (до 50 МБ, с поддержкой `Range`-запросов и автоочисткой через 12 часов).

## 1. Запуск на RU VPS (Timeweb / Selectel / Aeza)

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

## 2. Пример конфига Nginx (HTTPS + WebSocket)

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

## 3. Подключение фронтенда к своему RU-серверу

При сборке фронтенда задайте переменную окружения:

```bash
VITE_RU_SERVER_URL=https://api.ваш-домен.ru npm run build
```

Если переменная `VITE_RU_SERVER_URL` задана, приложение автоматически переходит на RU WebSocket `/ws`, HTTP-загрузку файлов до 50 МБ и сверхбыструю калибровку времени (без Firebase). Если переменная не задана — используется бесплатный режим по умолчанию на Firebase RTDB.
