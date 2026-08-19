#!/bin/sh
set -eu

ssh_target=${PAGES_SSH_TARGET:-deploy@135.106.180.237}

ssh -o BatchMode=yes -o ConnectTimeout=10 "$ssh_target" sudo -n sh -s <<'REMOTE'
set -eu
release_root=/srv/pages-live4dev
current=$(readlink -f "$release_root/current")
case "$current" in
  "$release_root/releases/"*) ;;
  *) printf 'Current symlink is outside the release root.\n' >&2; exit 1 ;;
esac
for required in index.html 404.html sitemap.xml robots.txt favicon.svg release.json; do
  test -s "$current/$required" || { printf 'Missing current file: %s\n' "$required" >&2; exit 1; }
done
jq -e '.schemaVersion == 1 and .siteId == "pages-live4dev" and .articleCount >= 0 and .routeCount >= 2' "$current/release.json" >/dev/null
caddy validate --config /etc/caddy/Caddyfile >/dev/null
curl -fsS http://127.0.0.1:4352/health | jq -e '.ok == true and .siteId == "pages-live4dev"' >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4351/_health)" = 204
for path in / /404-does-not-exist /api/articles /_health /mcp; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://pages.live4.dev$path" || true)
  case "$path:$code" in
    /:200|/404-does-not-exist:404|/api/articles:404|/_health:404|/mcp:404) ;;
    *) printf '%s returned unexpected HTTP %s.\n' "$path" "$code" >&2; exit 1 ;;
  esac
done
printf 'pages.live4.dev verified: release=%s articles=%s.\n' "$(basename "$current")" "$(jq -r .articleCount "$current/release.json")"
REMOTE
