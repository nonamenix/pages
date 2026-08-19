#!/bin/sh
set -eu

stack_dir=/opt/pages-live4dev
set -a
. "$stack_dir/.env"
set +a

cd "$stack_dir"
/opt/postgresql/scripts/verify-site-secret.sh pages-live4dev "$stack_dir/.env"
docker compose -p pages-live4dev \
  -f "$stack_dir/docker-compose.yml" \
  -f "$stack_dir/docker-compose.postgres.yml" \
  --env-file "$stack_dir/.env" exec -T publisher node -e '
  fetch("http://127.0.0.1:3000/publish", {
    method: "POST",
    headers: { "X-Webhook-Secret": process.env.PUBLISHER_WEBHOOK_SECRET },
  }).then(async (response) => {
    console.log(await response.text());
    if (!response.ok) process.exit(1);
  }).catch((error) => { console.error(error); process.exit(1); });
'
