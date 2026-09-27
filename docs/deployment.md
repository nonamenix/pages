# Развёртывание pages.live4.dev

## Контракт production

- host: `deploy@135.106.180.237`;
- stack: `/opt/pages-live4dev`;
- Compose project: `pages-live4dev`;
- Strapi: loopback `127.0.0.1:4351`;
- publisher: loopback `127.0.0.1:4352`;
- PostgreSQL: database `pages_live4dev`, role `pages_live4dev_app`, private network `strapi-database`;
- releases: `/srv/pages-live4dev/current` plus three previous releases;
- backups: `/var/backups/pages-live4dev`, retention 14 days.
- authenticated article API: `https://pages.live4.dev/api/articles` and `/api/articles/<documentId>`; Caddy requires a Bearer header and Strapi validates the API token and article permissions. Missing Bearer headers return `401`; anonymous Strapi article permissions remain disabled. Other `/api/*`, including `/api/publisher/site`, remain `404`.

Production deployment must not modify `sites.live4.dev` or restart a neighboring stack.

For a Caddy-only article API routing update, record the current site file checksum, active release and image IDs, and save the site file plus the main Caddyfile in a root-only backup directory before installation. Validate the candidate with the installed Caddy binary, install only the Pages site file and the matching verification script, validate the complete `/etc/caddy/Caddyfile`, then reload Caddy. On validation, reload or verification failure, restore the saved Pages file, validate the full configuration and reload it. A routing-only update does not require rebuilding or restarting Strapi or the publisher, or changing the database or token permissions.

## 1. Read-only preflight

1. Run the `strapi-sites` skill status script for `all`. If it is unavailable or reports a problem, stop.
2. Run `scripts/preflight-host.sh`; it must confirm that ports 4351 and 4352 are free for the first deployment.
3. Record UTC time, current DNS A/AAAA/CNAME answers and TTL for `pages.live4.dev`, disk/memory pressure, Caddy state, Docker projects, shared PostgreSQL health, and neighboring-service health.
4. Validate that no existing site, Caddy route, database, role, directory, or backup profile already uses `pages-live4dev`.
5. Record the exact prior DNS state. Do not assume the subdomain is empty.

## 2. Prepare the artifact and state

1. Run the full local validation and require a clean committed worktree.
2. Run `scripts/package-release.sh`; transfer the resulting tarball and matching SHA-256 through SSH.
3. On the host, verify checksum and archive paths before extraction. Transfer the explicit Git artifact only; never transfer `.git`, `.env`, `node_modules`, build output, releases, databases, uploads, or backups.
4. Create `/opt/pages-live4dev`, `/srv/pages-live4dev/{releases,previews}`, and `/var/backups/pages-live4dev` with ownership limited to the new stack’s needs.
5. Run `scripts/bootstrap-env.sh /opt/pages-live4dev`, replace the placeholder database password with the separately provisioned `pages_live4dev_app` secret, and keep `.env` root-owned mode `0600`.
6. Provision the database and role through the host’s existing PostgreSQL site-provisioning contract. Register `pages-live4dev` with the shared secret verifier and backup/restore dispatchers. If those contracts do not already support a new site, stop and review the exact shared-infrastructure patch before applying it.

For an update, first snapshot current code, image IDs, Compose config and `current`; create and verify a site backup before any schema/data change. Never overwrite server `.env` or persistent state.

## 3. Start privately

From `/opt/pages-live4dev`:

```sh
scripts/compose-production.sh config
scripts/compose-production.sh build
scripts/compose-production.sh up -d
scripts/compose-production.sh ps
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4351/_health
curl -fsS http://127.0.0.1:4352/health
```

Confirm that the verification article exists only as a draft, the initial public release contains zero articles, publisher logs have no errors, and release metadata contains `siteId=pages-live4dev`.

Before exposing `/admin`, open an SSH tunnel to `127.0.0.1:4351` and let the site owner create the first Strapi administrator. Do not transmit or store that password in the repository or task logs.

Generate a signed preview of `/verification-draft/` and confirm `no-store`, `noindex`, one `h1`, valid Blocks rendering, and an expiry exactly 15 minutes after creation.

Install and test the backup timer:

```sh
sudo -n cp systemd/pages-live4dev-backup.service /etc/systemd/system/
sudo -n cp systemd/pages-live4dev-backup.timer /etc/systemd/system/
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now pages-live4dev-backup.timer
sudo -n systemctl start pages-live4dev-backup.service
sudo -n /opt/pages-live4dev/scripts/verify-backup.sh
```

The backup must include a PostgreSQL custom-format dump, uploads, configuration metadata and checksums, and must pass isolated restore verification.

## 4. Public cutover — separate explicit approval required

Do not perform these steps based only on approval to build or stage the site.

1. Back up the active Caddy configuration and record its checksum.
2. Install `caddy/pages-production.caddy` as the only new route, run `caddy validate`, and reload Caddy without restarting applications.
3. Restore the exact prior Caddy file immediately if validation or reload fails.
4. Change only the `pages.live4.dev` DNS record to A `135.106.180.237`; do not add AAAA unless IPv6 is verified.
5. After DNS propagation and certificate issuance, run `scripts/verify.sh` and the full `strapi-sites` host status check.
6. Verify `/`, a missing route, `/admin`, `/api/articles`, `/_health`, `/mcp`, signed preview, TLS, headers, fresh Caddy/Strapi/publisher logs, timer state, and neighboring services.

## Rollback

- Content/build failure: publisher leaves `current` unchanged.
- Bad static release: run `scripts/rollback.sh`, then repeat the public probes.
- Bad code/image: restore the recorded code snapshot and image IDs; replace only `pages-live4dev` services.
- First deployment failure: restore the exact prior DNS state, disable only the pages Caddy route, validate/reload Caddy, and stop only this Compose project. Preserve PostgreSQL, uploads, releases and backups.
- Database or uploads restore is destructive: back up the broken state and obtain separate explicit approval before restoring.
