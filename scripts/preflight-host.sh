#!/bin/sh
set -eu

ssh_target=${PAGES_SSH_TARGET:-deploy@135.106.180.237}

ssh -o BatchMode=yes -o ConnectTimeout=10 "$ssh_target" sudo -n sh -s <<'REMOTE'
set -eu
printf 'host=%s time=%s\n' "$(hostname)" "$(date -u +%FT%TZ)"
df -h / /opt /srv /var/backups 2>/dev/null || df -h /
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'
caddy validate --config /etc/caddy/Caddyfile >/dev/null
for port in 4351 4352; do
  if ss -ltnH "sport = :$port" | grep -q .; then
    printf 'Required loopback port %s is occupied.\n' "$port" >&2
    exit 1
  fi
done
test "$(systemctl is-active caddy)" = active
test "$(systemctl is-active oppl-prototype.service)" = active
printf 'pages.live4.dev first-deployment preflight passed; ports 4351 and 4352 are free.\n'
REMOTE
