#!/bin/sh
set -eu

stack_dir=/opt/pages-live4dev
/opt/postgresql/scripts/verify-site-secret.sh pages-live4dev "$stack_dir/.env"
exec docker compose -p pages-live4dev -f "$stack_dir/docker-compose.yml" \
  -f "$stack_dir/docker-compose.postgres.yml" --env-file "$stack_dir/.env" "$@"
