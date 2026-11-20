#!/usr/bin/env bash
# Runs every 2 minutes (systemd timer mpad-autoupdate). If GitHub has a newer tested build on the
# 'deploy' branch, installs it with mpad-update (which backs up first and checks the app starts).
# The 'deploy' branch only changes after the automatic tests pass, so untested code never goes live.
# Turn off:  systemctl disable --now mpad-autoupdate.timer
set -uo pipefail
APP_DIR=/opt/mpad-suite/app
exec 9>/run/mpad-update.lock
flock -n 9 || exit 0                       # an update is already running
LOCAL=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null) || exit 0
REMOTE=$(timeout 30 git -C "$APP_DIR" ls-remote origin refs/heads/deploy 2>/dev/null | cut -f1)
[ -z "$REMOTE" ] && exit 0                 # GitHub unreachable: try next time
[ "$LOCAL" = "$REMOTE" ] && exit 0         # already up to date
echo "$(date '+%F %T') new version ${REMOTE:0:7} (was ${LOCAL:0:7}) – installing"
if /usr/local/sbin/mpad-update; then
  echo "$(date '+%F %T') updated to ${REMOTE:0:7}"
else
  echo "$(date '+%F %T') update FAILED – rolling back to ${LOCAL:0:7}"
  git -C "$APP_DIR" reset --hard "$LOCAL" && (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1)
  chown -R mpad:mpad /opt/mpad-suite
  systemctl restart mpad-suite
fi
