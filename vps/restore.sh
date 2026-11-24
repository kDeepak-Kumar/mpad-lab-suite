#!/usr/bin/env bash
# Restore the database from a backup file:  mpad-restore /var/backups/mpad-suite/suite-2026-11-03_0230.sqlite.gz
# Without an argument it lists the available backups.
set -euo pipefail
envval() { grep -E "^$1=" /etc/mpad-suite.env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "'\""; }
DATABASE_FILE=$(envval DATABASE_FILE); DISK_WARN_PCT=$(envval DISK_WARN_PCT)
DB="${DATABASE_FILE:-/var/lib/mpad-suite/suite.sqlite}"
DIR=/var/backups/mpad-suite
if [ $# -lt 1 ]; then echo "Backups available:"; ls -lh "$DIR"/suite-*.sqlite.gz 2>/dev/null || echo "  none"; echo "Usage: mpad-restore <file>"; exit 1; fi
SRC="$1"; [ -f "$SRC" ] || { echo "No such file: $SRC"; exit 1; }
read -rp "This replaces ALL current data with $SRC. Type RESTORE to continue: " OK
[ "$OK" = RESTORE ] || { echo "Cancelled."; exit 1; }
/usr/local/sbin/mpad-backup || true   # safety copy of the current state
systemctl stop mpad-suite
TMP=$(mktemp); if [[ "$SRC" == *.gz ]]; then gunzip -c "$SRC" > "$TMP"; else cp "$SRC" "$TMP"; fi
sqlite3 "$TMP" "PRAGMA integrity_check;" | grep -q '^ok$' || { echo "Backup file is damaged; nothing changed."; rm -f "$TMP"; systemctl start mpad-suite; exit 1; }
rm -f "$DB" "$DB-wal" "$DB-shm"
mv "$TMP" "$DB"; chown mpad:mpad "$DB"; chmod 640 "$DB"
systemctl start mpad-suite
echo "Restored from $SRC."
