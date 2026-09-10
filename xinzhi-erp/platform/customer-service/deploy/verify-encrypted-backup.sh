#!/bin/sh
set -eu

umask 077

backup_path=${1:-}
identity_file=${2:-}

for command_name in age tar sha256sum pg_restore mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required restore verification command is unavailable: $command_name" >&2
    exit 1
  }
done

if [ -z "$backup_path" ] || [ ! -d "$backup_path" ] || [ -L "$backup_path" ]; then
  echo "Backup verification requires a regular non-symbolic backup directory" >&2
  exit 1
fi
if [ -z "$identity_file" ] || [ ! -f "$identity_file" ] || [ -L "$identity_file" ]; then
  echo "Backup verification requires a regular non-symbolic age identity file" >&2
  exit 1
fi
case "$backup_path" in
  /*) ;;
  *) echo "Backup directory must be absolute" >&2; exit 1 ;;
esac
case "$identity_file" in
  /*) ;;
  *) echo "Age identity path must be absolute" >&2; exit 1 ;;
esac

encrypted="$backup_path/xzdesk-backup.tar.age"
checksums="$backup_path/SHA256SUMS"
test -f "$encrypted" && test ! -L "$encrypted"
test -f "$checksums" && test ! -L "$checksums"
(cd "$backup_path" && sha256sum -c SHA256SUMS >/dev/null)

work_root=$(mktemp -d)
case "$work_root" in
  /tmp/*|/var/tmp/*) ;;
  *) echo "Restore verification temporary directory is outside an approved root" >&2; exit 1 ;;
esac
cleanup() {
  case "$work_root" in
    /tmp/*|/var/tmp/*) rm -rf -- "$work_root" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

archive="$work_root/xzdesk-backup.tar"
extract_dir="$work_root/extracted"
mkdir "$extract_dir"
age --decrypt -i "$identity_file" -o "$archive" "$encrypted"
test -s "$archive"

tar -tf "$archive" > "$work_root/archive-files.txt"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$work_root/archive-files.txt"; then
  echo "Encrypted backup contains an unsafe archive path" >&2
  exit 1
fi
grep -Eq '^MANIFEST.txt$' "$work_root/archive-files.txt"
grep -Eq '^database/postgres.dump$' "$work_root/archive-files.txt"
grep -Eq '^config/production.env$' "$work_root/archive-files.txt"
grep -Eq '^uploads(/|$)' "$work_root/archive-files.txt"

tar -xf "$archive" -C "$extract_dir"
grep -Eq '^format=xzdesk-encrypted-backup-v1$' "$extract_dir/MANIFEST.txt"
grep -Eq '^backup_retention_days=([1-9]|[12][0-9]|30)$' "$extract_dir/MANIFEST.txt"
grep -Eq '^encryption=age-recipient$' "$extract_dir/MANIFEST.txt"
pg_restore --list "$extract_dir/database/postgres.dump" >/dev/null

echo "Encrypted backup restore verification passed"
