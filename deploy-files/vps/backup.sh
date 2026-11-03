#!/usr/bin/env bash
# Safe online backup of the SQLite database (works while the app is running).
# Keeps KEEP_DAYS days on the server; if rclone has a remote named "gdrive", also copies
# to Google Drive folder MPAD-Backups and keeps DRIVE_KEEP_DAYS days there.
set -euo pipefail
envval() { grep -E "^$1=" /etc/mpad-suite.env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "'\""; }
DATABASE_FILE=$(envval DATABASE_FILE); DISK_WARN_PCT=$(envval DISK_WARN_PCT)
DB="${DATABASE_FILE:-/var/lib/mpad-suite/suite.sqlite}"
DIR="${BACKUP_DIR:-/var/backups/mpad-suite}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DRIVE_KEEP_DAYS="${DRIVE_KEEP_DAYS:-90}"
mkdir -p "$DIR"
STAMP=$(date +%Y-%m-%d_%H%M%S)
OUT="$DIR/suite-$STAMP.sqlite"

sqlite3 "$DB" ".backup '$OUT'"
sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -q '^ok$' || { echo "$(date) backup integrity check FAILED"; rm -f "$OUT"; exit 1; }
gzip -9f "$OUT"
echo "$(date) backup ok: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"

# keep the server's disk in check
find "$DIR" -name 'suite-*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete

if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q '^gdrive:$'; then
  rclone copy "$OUT.gz" gdrive:MPAD-Backups --quiet && echo "$(date) copied to Google Drive"
  rclone delete gdrive:MPAD-Backups --min-age "${DRIVE_KEEP_DAYS}d" --include 'suite-*.sqlite.gz' --quiet || true
fi

USED=$(df --output=pcent "$DIR" | tail -1 | tr -dc '0-9')
[ "${USED:-0}" -ge "${DISK_WARN_PCT:-80}" ] && echo "$(date) WARNING: disk ${USED}% full"
exit 0
