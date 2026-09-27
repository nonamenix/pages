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
for required in index.html 404.html sitemap.xml robots.txt favicon.svg release.json new/index.html fonts/charter-400-normal.woff fonts/kievit-700-normal.woff; do
  test -s "$current/$required" || { printf 'Missing current file: %s\n' "$required" >&2; exit 1; }
done
jq -e '.schemaVersion == 1 and .siteId == "pages-live4dev" and .articleCount >= 0 and .routeCount >= 2' "$current/release.json" >/dev/null
caddy validate --config /etc/caddy/Caddyfile >/dev/null
curl -fsS http://127.0.0.1:4352/health | jq -e '.ok == true and .siteId == "pages-live4dev"' >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4351/_health)" = 204
for path in / /new /admin/pages-session.html /404-does-not-exist /api/articles /api/articles/verification-document-id /api/articles-other /api/publisher/site /_health /mcp; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://pages.live4.dev$path" || true)
  case "$path:$code" in
    /:200|/new:200|/admin/pages-session.html:200|/404-does-not-exist:404|/api/articles:401|/api/articles/verification-document-id:401|/api/articles-other:404|/api/publisher/site:404|/_health:404|/mcp:404) ;;
    *) printf '%s returned unexpected HTTP %s.\n' "$path" "$code" >&2; exit 1 ;;
  esac
done
curl -fsS https://pages.live4.dev/new | grep -q 'noindex'
test "$(curl -fsS https://pages.live4.dev/new | grep -c 'src="/metrika.js"' || true)" = 0
curl -fsS https://pages.live4.dev/admin/pages-session.html | grep -q '/admin/pages-session-'
bridge_headers=$(curl -fsSI https://pages.live4.dev/admin/pages-session.html | tr -d '\r')
test "$(printf '%s\n' "$bridge_headers" | grep -ic '^x-frame-options:')" = 1
printf '%s\n' "$bridge_headers" | grep -qix 'x-frame-options: SAMEORIGIN'
printf '%s\n' "$bridge_headers" | grep -qixF "content-security-policy: default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'"
admin_headers=$(curl -fsSI https://pages.live4.dev/admin/auth/login | tr -d '\r')
test "$(printf '%s\n' "$admin_headers" | grep -ic '^x-frame-options:')" = 1
printf '%s\n' "$admin_headers" | grep -qix 'x-frame-options: DENY'
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -H 'Authorization: Bearer invalid-verification-token' https://pages.live4.dev/api/articles || true)
case "$code" in
  401|403) ;;
  *) printf 'Invalid API token returned unexpected HTTP %s.\n' "$code" >&2; exit 1 ;;
esac
printf 'pages.live4.dev verified: release=%s articles=%s.\n' "$(basename "$current")" "$(jq -r .articleCount "$current/release.json")"
REMOTE
