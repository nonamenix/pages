#!/bin/sh
set -eu

stack_dir=/opt/pages-live4dev
route=${1:-/}
set -a
. "$stack_dir/.env"
set +a

cd "$stack_dir"
/opt/postgresql/scripts/verify-site-secret.sh pages-live4dev "$stack_dir/.env"
docker compose -p pages-live4dev \
  -f "$stack_dir/docker-compose.yml" \
  -f "$stack_dir/docker-compose.postgres.yml" \
  --env-file "$stack_dir/.env" exec -T publisher node -e '
  const route = process.argv[1];
  fetch("http://127.0.0.1:3000/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": process.env.PUBLISHER_WEBHOOK_SECRET,
    },
    body: JSON.stringify({ route }),
  }).then(async (response) => {
    console.log(await response.text());
    if (!response.ok) process.exit(1);
  }).catch((error) => { console.error(error); process.exit(1); });
' "$route"
