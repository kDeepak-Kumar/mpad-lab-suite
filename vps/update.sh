#!/usr/bin/env bash
# Install the latest version: backup first, pull the ready-built deploy branch, restart, check.
set -euo pipefail
APP_DIR=/opt/mpad-suite/app
echo "Backing up first..."
/usr/local/sbin/mpad-backup
OLD=$(git -C "$APP_DIR" rev-parse --short HEAD)
git -C "$APP_DIR" fetch --depth 1 origin deploy
git -C "$APP_DIR" reset --hard origin/deploy
NEW=$(git -C "$APP_DIR" rev-parse --short HEAD)
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
chown -R mpad:mpad /opt/mpad-suite
for f in update backup restore autoupdate; do [ -f "$APP_DIR/vps/$f.sh" ] && install -m 755 "$APP_DIR/vps/$f.sh" "/usr/local/sbin/mpad-$f"; done
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
[ -f /etc/systemd/system/mpad-autoupdate.timer ] || install_autoupdate
systemctl restart mpad-suite
for i in $(seq 1 30); do curl -fs http://127.0.0.1:4000/api/health >/dev/null && break; sleep 2; done
if curl -fs http://127.0.0.1:4000/api/health >/dev/null; then
  echo "Updated $OLD -> $NEW. App is running."
else
  echo "App did not start after update. Log: journalctl -u mpad-suite -n 80"
  echo "To go back: git -C $APP_DIR reset --hard $OLD && systemctl restart mpad-suite"
  exit 1
fi
