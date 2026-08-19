#!/bin/sh
set -eu

exec /opt/postgresql/scripts/verify-site-backup-dispatch.sh pages-live4dev "${1:-}"
