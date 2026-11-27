#!/usr/bin/env bash
set -euo pipefail

# Автоматический установщик WaveSync (фронтенд + RU WebSocket/HTTP сервер + Nginx + HTTPS + PM2)
# Запуск без домена (авто-домен sslip.io / nip.io / traefik.me):
#   curl -4 -sL https://raw.githubusercontent.com/vitvit147-sketch/wawes/main/server/setup-vps.sh | sudo bash
# Запуск со своим .ru доменом:
#   curl -4 -sL https://raw.githubusercontent.com/vitvit147-sketch/wawes/main/server/setup-vps.sh | sudo bash -s -- ваш-домен.ru

CUSTOM_DOMAIN="${1:-}"
REPO_URL="https://github.com/vitvit147-sketch/wawes.git"
APP_DIR="/opt/wavesync"

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите скрипт с правами root (через sudo bash ...)"
  exit 1
fi

echo "=== [1/7] Настройка swap (1.5 ГБ для стабильной сборки на 1 ГБ RAM) ==="
if [ ! -f /swapfile ] && [ "$(swapon --show | wc -l)" -le 1 ]; then
  fallocate -l 1536M /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1536
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab || true
fi

echo "=== [2/7] Установка системных пакетов (git, curl, nginx, certbot, Node.js 20) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg xz-utils nginx certbot python3-certbot-nginx

install_node20() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/v//' | cut -d. -f1 || echo 0)"
    if [ "${major:-0}" -ge 20 ]; then
      echo "Node.js $(node -v) уже установлен."
      return 0
    fi
  fi

  echo "Скачиваем официальный архив Node.js v20.19.0 (IPv4)..."
  local tmp_txz="/tmp/node20.tar.xz"
  if curl -4 -fSL --connect-timeout 15 --max-time 120 \
    "https://nodejs.org/dist/v20.19.0/node-v20.19.0-linux-x64.tar.xz" -o "$tmp_txz"; then
    tar -xJf "$tmp_txz" -C /usr/local --strip-components=1
    rm -f "$tmp_txz"
    hash -r
    echo "Node.js $(node -v) установлен через nodejs.org!"
    return 0
  fi

  echo "Fallback: установка Node.js 20 через snap..."
  if command -v snap >/dev/null 2>&1 && snap install node --classic --channel=20/stable; then
    export PATH="/snap/bin:$PATH"
    echo "Node.js $(node -v) установлен через snap!"
    return 0
  fi

  echo "Fallback: установка через NodeSource (IPv4)..."
  curl -4 -fsSL --connect-timeout 15 --max-time 60 https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

install_node20
export PATH="/usr/local/bin:/snap/bin:$PATH"
npm install -g pm2

echo "=== [3/7] Скачивание репозитория WaveSync ==="
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin main
  git -C "$APP_DIR" reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

echo "=== [4/7] Установка зависимостей RU-сервера и фронтенда ==="
cd "$APP_DIR/server"
npm install --omit=dev

cd "$APP_DIR"
npm install

echo "=== [5/7] Запуск RU WebSocket/HTTP сервера через PM2 ==="
pm2 delete wavesync-ru >/dev/null 2>&1 || true
PORT=3080 UPLOAD_DIR="$APP_DIR/server/uploads" pm2 start "$APP_DIR/server/index.js" --name wavesync-ru
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "=== [6/7] Подбор домена и выпуск бесплатного SSL-сертификата ==="
PUBLIC_IP="$(curl -4 -fsS --connect-timeout 6 --max-time 10 https://api.ipify.org \
  || curl -4 -fsS --connect-timeout 6 --max-time 10 https://ifconfig.me \
  || curl -4 -fsS --connect-timeout 6 --max-time 10 https://ident.me \
  || true)"
PUBLIC_IP="$(echo "$PUBLIC_IP" | tr -d '[:space:]')"
IP_DASH="${PUBLIC_IP//./-}"

if [ -n "$CUSTOM_DOMAIN" ]; then
  CANDIDATES=("$CUSTOM_DOMAIN")
else
  CANDIDATES=(
    "${IP_DASH}.sslip.io"
    "${PUBLIC_IP}.nip.io"
    "${IP_DASH}.traefik.me"
  )
fi

ACTIVE_DOMAIN=""
for DOM in "${CANDIDATES[@]}"; do
  [ -z "$DOM" ] && continue
  echo "Пробуем домен: $DOM ..."

  cat > /etc/nginx/sites-available/wavesync <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOM _;

    root $APP_DIR/dist;
    index index.html;
    client_max_body_size 55M;

    location /ws {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host \$host;
        proxy_request_buffering off;
    }

    location /health {
        proxy_pass http://127.0.0.1:3080;
    }

    location /music/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        add_header Access-Control-Allow-Origin "*";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/wavesync /etc/nginx/sites-enabled/wavesync
  nginx -t && systemctl reload nginx

  if certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d "$DOM"; then
    ACTIVE_DOMAIN="$DOM"
    echo "SSL успешно выпущен для https://$ACTIVE_DOMAIN"
    break
  else
    echo "Не удалось выпустить SSL для $DOM, пробуем следующий..."
  fi
done

echo "=== [7/7] Сборка фронтенда с подключённым RU-сервером ==="
cd "$APP_DIR"
if [ -n "$ACTIVE_DOMAIN" ]; then
  SITE_URL="https://$ACTIVE_DOMAIN"
  VITE_RU_SERVER_URL="$SITE_URL" NODE_OPTIONS="--max-old-space-size=1024" npm run build
else
  SITE_URL="http://${PUBLIC_IP:-168.113.142.76}"
  VITE_RU_SERVER_URL="$SITE_URL" NODE_OPTIONS="--max-old-space-size=1024" npm run build
  echo "Внимание: SSL не удалось выпустить автоматически, сайт работает по HTTP ($SITE_URL)."
fi

systemctl reload nginx

echo ""
echo "================================================================"
echo "  ГОТОВО! WaveSync запущен на российском сервере!"
echo "  Откройте в браузере: $SITE_URL"
echo "================================================================"
