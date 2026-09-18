#!/bin/sh
set -eu

set -- ${SSH_ORIGINAL_COMMAND:-}
[ "$#" -ge 1 ] || exit 2
case "$1" in
  verify) [ "$#" -eq 1 ] || exit 2 ;;
  deploy) [ "$#" -eq 3 ] || exit 2 ;;
  *) exit 2 ;;
esac
exec /usr/bin/sudo -n /usr/local/sbin/recruitment-release-gateway "$@"
