#!/bin/sh
set -eu

target_dir=${1:-/opt/pages-live4dev}
env_file="$target_dir/.env"

umask 077
random_hex() {
  openssl rand -hex 32
}

append_if_missing() {
  key=$1
  value=$2
  if ! grep -q "^${key}=" "$env_file"; then
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

if [ -f "$env_file" ]; then
  append_if_missing STRAPI_API_TOKEN "$(random_hex)"
  append_if_missing PUBLISHER_WEBHOOK_SECRET "$(random_hex)"
  append_if_missing PREVIEW_SIGNING_SECRET "$(random_hex)"
  append_if_missing MEDIA_PUBLIC_BASE_URL 'https://pages.live4.dev/uploads'
  append_if_missing SITE_URL 'https://pages.live4.dev'
  append_if_missing STRAPI_INTERNAL_URL 'http://strapi:1337'
  append_if_missing STRAPI_MCP_ENABLED 'false'
  append_if_missing SEED_VERIFICATION_DRAFT 'true'
  chmod 600 "$env_file"
  exit 0
fi

{
  printf '%s\n' 'PUBLIC_URL=https://pages.live4.dev'
  printf '%s\n' 'SITE_URL=https://pages.live4.dev'
  printf '%s\n' 'PAGES_RELEASES_DIR=/srv/pages-live4dev'
  printf '%s\n' 'PAGES_CONTENT_SOURCE=strapi'
  printf '%s\n' 'STRAPI_URL=http://127.0.0.1:4351'
  printf '%s\n' 'STRAPI_INTERNAL_URL=http://strapi:1337'
  printf '%s\n' 'MEDIA_PUBLIC_BASE_URL=https://pages.live4.dev/uploads'
  printf '%s\n' 'STRAPI_MCP_ENABLED=false'
  printf '%s\n' 'SEED_VERIFICATION_DRAFT=true'
  printf '%s\n' 'DATABASE_FILENAME=/opt/app/database/data.db'
  printf '%s\n' 'DATABASE_NAME=pages_live4dev'
  printf '%s\n' 'DATABASE_USERNAME=pages_live4dev_app'
  printf '%s\n' 'CORS_ORIGINS=http://127.0.0.1:8095,https://pages.live4.dev'
  printf 'APP_KEYS=%s,%s,%s,%s\n' "$(random_hex)" "$(random_hex)" "$(random_hex)" "$(random_hex)"
  printf 'API_TOKEN_SALT=%s\n' "$(random_hex)"
  printf 'ADMIN_JWT_SECRET=%s\n' "$(random_hex)"
  printf 'TRANSFER_TOKEN_SALT=%s\n' "$(random_hex)"
  printf 'JWT_SECRET=%s\n' "$(random_hex)"
  printf 'ENCRYPTION_KEY=%s\n' "$(random_hex)"
  printf 'STRAPI_API_TOKEN=%s\n' "$(random_hex)"
  printf 'PUBLISHER_WEBHOOK_SECRET=%s\n' "$(random_hex)"
  printf 'PREVIEW_SIGNING_SECRET=%s\n' "$(random_hex)"
  printf '%s\n' 'UPLOAD_MAX_BYTES=10485760'
  printf '%s\n' 'DATABASE_PASSWORD=REPLACE_WITH_PROVISIONED_POSTGRES_PASSWORD'
} > "$env_file"

chmod 600 "$env_file"
