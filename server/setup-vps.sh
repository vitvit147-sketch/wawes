#!/usr/bin/env bash
set -euo pipefail

# Автоматический установщик WaveSync + «Игры для компании»
# Аргумент 1: основной домен (WaveSync), например xn--90aipmfnffdc2f5a.space
# Аргумент 2 (опционально): домен для игр, например games.xn--90aipmfnffdc2f5a.space

CUSTOM_DOMAIN="${1:-}"
GAMES_DOMAIN="${2:-}"
REPO_URL="https://github.com/vitvit147-sketch/wawes.git"
TAR_URL="https://codeload.github.com/vitvit147-sketch/wawes/tar.gz/refs/heads/main"
APP_DIR="/opt/wavesync"

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите скрипт с правами root (через sudo bash ...)"
  exit 1
fi

echo "=== [0/7] Оптимизация MTU (1400) и закрепление в systemd ==="
DEFAULT_IFACE="$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}' || true)"
if [ -n "$DEFAULT_IFACE" ]; then
  ip link set dev "$DEFAULT_IFACE" mtu 1400 || true
  cat > /etc/systemd/system/wavesync-mtu.service <<EOF
[Unit]
Description=Set MTU 1400 for VK Cloud VXLAN
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/sbin/ip link set dev $DEFAULT_IFACE mtu 1400
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable wavesync-mtu.service >/dev/null 2>&1 || true
fi

export PATH="/usr/local/bin:/snap/bin:$PATH"
export NODE_OPTIONS="--dns-result-order=ipv4first --max-old-space-size=1024"

echo "=== [1/7] Настройка swap (1.5 ГБ) ==="
if [ ! -f /swapfile ] && [ "$(swapon --show | wc -l)" -le 1 ]; then
  fallocate -l 1536M /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1536
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab || true
fi

echo "=== [2/7] Проверка и установка системных пакетов ==="
export DEBIAN_FRONTEND=noninteractive
if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y curl git ca-certificates gnupg xz-utils nginx certbot python3-certbot-nginx
fi

install_node20() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/v//' | cut -d. -f1 || echo 0)"
    if [ "${major:-0}" -ge 20 ]; then
      return 0
    fi
  fi
  local tmp_txz="/tmp/node20.tar.xz"
  if curl -4 -fSL --connect-timeout 15 --max-time 120 \
    "https://nodejs.org/dist/v20.19.0/node-v20.19.0-linux-x64.tar.xz" -o "$tmp_txz"; then
    tar -xJf "$tmp_txz" -C /usr/local --strip-components=1
    rm -f "$tmp_txz"
    hash -r
    return 0
  fi
  if command -v snap >/dev/null 2>&1 && snap install node --classic --channel=20/stable; then
    export PATH="/snap/bin:$PATH"
    return 0
  fi
  curl -4 -fsSL --connect-timeout 15 --max-time 60 https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

install_node20
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "=== [3/7] Скачивание/обновление проекта (IPv4) ==="
if [ -d "$APP_DIR/.git" ]; then
  if ! git -C "$APP_DIR" -c http.version=HTTP/1.1 fetch -4 --depth 1 origin main; then
    rm -rf "$APP_DIR"
  else
    git -C "$APP_DIR" reset --hard origin/main
  fi
fi

if [ ! -d "$APP_DIR/src" ]; then
  rm -rf "$APP_DIR"
  if ! git -c http.version=HTTP/1.1 clone -4 --depth 1 "$REPO_URL" "$APP_DIR"; then
    curl -4 -fSL --connect-timeout 15 --max-time 180 "$TAR_URL" -o /tmp/wawes.tar.gz
    mkdir -p "$APP_DIR"
    tar -xzf /tmp/wawes.tar.gz -C "$APP_DIR" --strip-components=1
    rm -f /tmp/wawes.tar.gz
  fi
fi

if [ -f "$APP_DIR/server/games-dist.tar.gz" ]; then
  rm -rf "$APP_DIR/games-dist"
  mkdir -p "$APP_DIR/games-dist"
  tar -xzf "$APP_DIR/server/games-dist.tar.gz" -C "$APP_DIR/games-dist"
fi

echo "=== [4/7] Установка зависимостей ==="
cd "$APP_DIR/server"
npm install --omit=dev
cd "$APP_DIR"
npm install

echo "=== [5/7] Запуск RU WebSocket/HTTP сервера через PM2 ==="
pm2 delete wavesync-ru >/dev/null 2>&1 || true
PORT=3080 UPLOAD_DIR="$APP_DIR/server/uploads" pm2 start "$APP_DIR/server/index.js" --name wavesync-ru
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "=== [6/7] Настройка Nginx и SSL для WaveSync и Игр ==="
PUBLIC_IP="$(curl -4 -fsS --connect-timeout 6 --max-time 10 https://api.ipify.org \
  || curl -4 -fsS --connect-timeout 6 --max-time 10 https://ifconfig.me \
  || echo 168.113.142.76)"
PUBLIC_IP="$(echo "$PUBLIC_IP" | tr -d '[:space:]')"
IP_DASH="${PUBLIC_IP//./-}"

if [ -n "$CUSTOM_DOMAIN" ]; then
  CANDIDATES=("$CUSTOM_DOMAIN")
else
  CANDIDATES=("${IP_DASH}.sslip.io" "${PUBLIC_IP}.nip.io" "${IP_DASH}.traefik.me")
fi

ACTIVE_DOMAIN=""
for DOM in "${CANDIDATES[@]}"; do
  [ -z "$DOM" ] && continue

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
    break
  fi
done

GAMES_URL=""
if [ -n "$GAMES_DOMAIN" ]; then
  cat > /etc/nginx/sites-available/games <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $GAMES_DOMAIN;

    root $APP_DIR/games-dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/games /etc/nginx/sites-enabled/games
  nginx -t && systemctl reload nginx
  if certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d "$GAMES_DOMAIN"; then
    GAMES_URL="https://$GAMES_DOMAIN"
  else
    GAMES_URL="http://$GAMES_DOMAIN"
  fi
fi

echo "=== [7/7] Сборка фронтенда WaveSync ==="
cd "$APP_DIR"
if [ -n "$ACTIVE_DOMAIN" ]; then
  SITE_URL="https://$ACTIVE_DOMAIN"
else
  SITE_URL="http://${PUBLIC_IP:-168.113.142.76}"
fi
VITE_RU_SERVER_URL="$SITE_URL" npm run build
systemctl reload nginx

echo ""
echo "================================================================"
echo "  ГОТОВО! Оба проекта запущены на российском сервере!"
echo "  WaveSync (музыка):        $SITE_URL"
if [ -n "$GAMES_URL" ]; then
  echo "  Игры для компании:        $GAMES_URL"
fi
echo "================================================================"
