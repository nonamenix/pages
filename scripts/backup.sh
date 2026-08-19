#!/bin/sh
set -eu

exec /opt/postgresql/scripts/backup-site-dispatch.sh pages-live4dev
