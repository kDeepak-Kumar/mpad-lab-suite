#!/usr/bin/env bash
# MPAD Lab Suite – one-time setup of a fresh Ubuntu 24.04 VPS (Hostinger KVM or any other).
# Run as root:
#   curl -fsSL https://raw.githubusercontent.com/kDeepak-Kumar/mpad-lab-suite/main/deploy-files/vps/setup.sh -o setup.sh
#   bash setup.sh
# It asks for: the web address (e.g. app.mpadqclab.com), the owner's name, email and first password.
# Nothing secret is stored in GitHub: secrets go to /etc/mpad-suite.env (readable by root only).
set -euo pipefail

REPO="${REPO:-https://github.com/kDeepak-Kumar/mpad-lab-suite.git}"
APP_DIR=/opt/mpad-suite/app
DATA_DIR=/var/lib/mpad-suite
BACKUP_DIR=/var/backups/mpad-suite
ENV_FILE=/etc/mpad-suite.env
NODE_MAJOR=22

[ "$(id -u)" = 0 ] || { echo "Run this as root (sudo -i first)."; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "Warning: written for Ubuntu 24.04; continuing on ${PRETTY_NAME:-unknown}."

echo "== MPAD Lab Suite server setup =="
read -rp "Web address for the app (e.g. app.mpadqclab.com): " DOMAIN
read -rp "Owner's full name: " ADMIN_NAME
read -rp "Owner's login email: " ADMIN_EMAIL
while :; do
  read -rsp "Owner's first password (min 8 chars, no quotes or backslash; change it after first login): " ADMIN_PASSWORD; echo
  case "$ADMIN_PASSWORD" in *\'*|*\"*|*\\*) echo "Please avoid quotes and backslashes."; continue;; esac
  [ ${#ADMIN_PASSWORD} -ge 8 ] && break; echo "Too short, try again."
done
ADMIN_NAME="${ADMIN_NAME//\'/}"
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

echo "== 1/8 System updates, time zone and basic tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw sqlite3 gzip ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades
timedatectl set-timezone Asia/Kolkata || true
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "== 2/8 Node.js ${NODE_MAJOR}"
if ! node -v 2>/dev/null | grep -q "^v${NODE_MAJOR}"; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 3/8 Caddy web server (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 4/8 App user and folders"
id mpad >/dev/null 2>&1 || useradd --system --home /opt/mpad-suite --shell /usr/sbin/nologin mpad
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

echo "== 5/8 Download the app (ready-built 'deploy' branch)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin deploy && git -C "$APP_DIR" reset --hard origin/deploy
else
  rm -rf "$APP_DIR" && git clone --depth 1 --branch deploy "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
git config --system --add safe.directory "$APP_DIR"
for f in update backup restore autoupdate; do install -m 755 "$APP_DIR/vps/$f.sh" "/usr/local/sbin/mpad-$f"; done
chown -R mpad:mpad /opt/mpad-suite "$DATA_DIR"

echo "== 6/8 Settings file ($ENV_FILE, root only)"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=4000
DB_CLIENT=sqlite
DATABASE_FILE=$DATA_DIR/suite.sqlite
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=true
APP_TIMEZONE=Asia/Kolkata
ADMIN_NAME='$ADMIN_NAME'
ADMIN_EMAIL=$ADMIN_EMAIL
# Used only to create the owner on first start; cleared automatically afterwards
ADMIN_PASSWORD='$ADMIN_PASSWORD'
# Mailbox password for Settings > Company > Email & alerts (fill in, then: systemctl restart mpad-suite)
SMTP_PASSWORD=
DISK_WARN_PCT=80
ENV
  chmod 600 "$ENV_FILE"
else
  echo "   $ENV_FILE already exists – kept as is."
fi

echo "== 7/8 Services: app, HTTPS, firewall, nightly backup"
cat > /etc/systemd/system/mpad-suite.service <<UNIT
[Unit]
Description=MPAD Lab Suite
After=network-online.target
Wants=network-online.target

[Service]
User=mpad
Group=mpad
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_DIR/server.cjs
Restart=always
RestartSec=5
MemoryMax=1500M
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR $APP_DIR

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	request_body {
		max_size 20MB
	}
	reverse_proxy 127.0.0.1:4000
}
CADDY

cat > /etc/cron.d/mpad-suite <<CRON
# Nightly database backup at 02:30 India time (keeps 14 days here; copies to Google Drive if set up)
30 2 * * * root /usr/local/sbin/mpad-backup >> /var/log/mpad-backup.log 2>&1
CRON

# Keep system logs small
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=300M\n' > /etc/systemd/journald.conf.d/size.conf
systemctl restart systemd-journald || true

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now mpad-suite
systemctl reload caddy || systemctl restart caddy

install_autoupdate() {
  install -m 755 "$APP_DIR/vps/autoupdate.sh" /usr/local/sbin/mpad-autoupdate
  cat > /etc/systemd/system/mpad-autoupdate.service <<UNIT
[Unit]
Description=MPAD Lab Suite – install new tested version from GitHub
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/mpad-autoupdate
StandardOutput=append:/var/log/mpad-update.log
StandardError=append:/var/log/mpad-update.log
UNIT
  cat > /etc/systemd/system/mpad-autoupdate.timer <<UNIT
[Unit]
Description=Check GitHub for a new MPAD Lab Suite version every 2 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now mpad-autoupdate.timer >/dev/null 2>&1
}
install_autoupdate

echo "== 8/8 Checking the app"
for i in $(seq 1 30); do curl -fs http://127.0.0.1:4000/api/health >/dev/null && break; sleep 2; done
if curl -fs http://127.0.0.1:4000/api/health >/dev/null; then
  echo "   App is running."
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/" "$ENV_FILE"   # owner exists now; don't keep the password on disk
else
  echo "   App did not start. See: journalctl -u mpad-suite -n 50"; exit 1
fi
IP=$(curl -fs4 https://api.ipify.org || hostname -I | awk '{print $1}')

cat <<DONE

==============================================================
 Done. Next:
 1. In GoDaddy DNS add an A record:  ${DOMAIN%%.*}  ->  $IP
 2. Wait 5-30 minutes, then open  https://$DOMAIN
    (HTTPS certificate is issued automatically on first visit)
 3. Sign in as $ADMIN_EMAIL and change the password.
 Useful commands:
   New versions install automatically within ~5 minutes of a push (log: /var/log/mpad-update.log)
   mpad-update      install the latest version now (backs up first)
   mpad-backup      take a backup now
   mpad-restore     restore from a backup
   journalctl -u mpad-suite -n 100   app log
==============================================================
DONE
